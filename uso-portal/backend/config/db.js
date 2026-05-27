// config/db.js
const mysql = require('mysql2/promise');

// MySQL connection configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'wifi_payment_portal',
  charset: 'utf8mb4',
  timezone: '+00:00',
  connectionLimit: 10,
  queueLimit: 0,
  waitForConnections: true,
  idleTimeout: 600000
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

const log = (...messages) => console.log(new Date().toISOString(), '[DB]', ...messages);

// Test database connection
const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    log('✓ MySQL connection successful');
    return true;
  } catch (error) {
    log('✗ MySQL connection failed:', error.message);
    return false;
  }
};

// Initialize database tables
const initializeDatabase = async () => {
  try {
    log('Initializing MySQL database tables...');
    
    // Create transactions table
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR(255) PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        plan_id VARCHAR(100) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        voucher_code VARCHAR(100) NULL,
        status VARCHAR(50) DEFAULT 'initiated',
        
        -- M-PAiSA specific fields
        mpaisa_request_id VARCHAR(255) NULL,
        mpaisa_response_code VARCHAR(10) NULL,
        customer_phone_number VARCHAR(20) NULL,
        
        -- Payment gateway response (JSON)
        payment_response TEXT NULL,
        
        -- Auto authentication details
        auth_attempted BOOLEAN DEFAULT FALSE,
        auth_success BOOLEAN DEFAULT FALSE,
        auth_response TEXT NULL,
        auth_logon_url TEXT NULL,
        auth_error TEXT NULL,
        
        -- Timestamps
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        payment_completed_at TIMESTAMP NULL,
        auth_completed_at TIMESTAMP NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        -- Metadata
        client_ip VARCHAR(45) NULL,
        client_mac VARCHAR(17) NULL,
        user_agent TEXT NULL,
        callback_processed BOOLEAN DEFAULT FALSE,

        -- Indexes
        INDEX idx_session_id (session_id),
        INDEX idx_status (status),
        INDEX idx_created_at (created_at),
        INDEX idx_client_mac (client_mac)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create sessions table
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id VARCHAR(255) PRIMARY KEY,
        client_ip VARCHAR(45) NULL,
        client_mac VARCHAR(17) NULL,
        user_agent TEXT NULL,
        portal_entry_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        is_authenticated BOOLEAN DEFAULT FALSE,
        voucher_code VARCHAR(100) NULL,
        logon_url TEXT NULL,
        INDEX idx_client_mac (client_mac)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Migrate existing tables: add client_mac column if missing
    for (const table of ['sessions', 'transactions']) {
      try {
        await pool.execute(`ALTER TABLE ${table} ADD COLUMN client_mac VARCHAR(17) NULL AFTER client_ip`);
        log(`  Added client_mac column to ${table} table`);
      } catch (e) { /* column already exists */ }
      try {
        await pool.execute(`ALTER TABLE ${table} ADD INDEX idx_client_mac (client_mac)`);
      } catch (e) { /* index already exists */ }
    }

    // Create transaction history table
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS transaction_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        transaction_id VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL,
        details TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        INDEX idx_transaction_id (transaction_id),
        INDEX idx_created_at (created_at),
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create processing locks table
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS processing_locks (
        transaction_id VARCHAR(255) PRIMARY KEY,
        locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        process_id VARCHAR(100) NULL,
        expires_at TIMESTAMP NULL,
        
        INDEX idx_expires_at (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Create manual assistance table
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS manual_assistance_required (
        id INT AUTO_INCREMENT PRIMARY KEY,
        transaction_id VARCHAR(255) NOT NULL,
        session_id VARCHAR(255) NOT NULL,
        
        -- Customer Details
        customer_phone VARCHAR(20) NULL,
        customer_ip VARCHAR(45) NULL,
        
        -- Transaction Details
        plan_id VARCHAR(100) NOT NULL,
        amount_paid DECIMAL(10,2) NOT NULL,
        payment_completed_at TIMESTAMP NOT NULL,
        
        -- Authentication Failure Details
        voucher_code VARCHAR(100) NULL,
        auth_failure_reason TEXT NOT NULL,
        auth_response TEXT NULL,
        ruijie_error_message VARCHAR(500) NULL,
        
        -- Status
        status ENUM('PENDING', 'CONTACTED', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED') DEFAULT 'PENDING',
        
        -- Manual Intervention Tracking
        assigned_to VARCHAR(100) NULL,
        contacted_at TIMESTAMP NULL,
        resolved_at TIMESTAMP NULL,
        resolution_notes TEXT NULL,
        
        -- Timestamps
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        -- Indexes
        INDEX idx_status (status),
        INDEX idx_created_at (created_at),
        INDEX idx_customer_phone (customer_phone),
        INDEX idx_transaction_id (transaction_id),
        
        -- Foreign keys
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    log('✓ Database tables initialized successfully');
    
  } catch (error) {
    log('✗ Database initialization failed:', error.message);
    throw error;
  }
};

// Database operations class
class TransactionDB {
  static async createTransaction(transactionData) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { id, sessionId, planId, amount, voucherCode, clientIp, clientMac, userAgent } = transactionData;

      // Create the transaction
      await connection.execute(`
        INSERT INTO transactions (
          id, session_id, plan_id, amount, voucher_code, client_ip, client_mac, user_agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [id, sessionId, planId, amount, voucherCode, clientIp, clientMac || null, userAgent]);
      
      // Add initial history entry
      await connection.execute(`
        INSERT INTO transaction_history (transaction_id, status, details)
        VALUES (?, ?, ?)
      `, [id, 'initiated', JSON.stringify({
        sessionId,
        planId,
        amount,
        voucherCode
      })]);

      await connection.commit();

      // Get the created transaction
      const [rows] = await connection.execute(
        'SELECT * FROM transactions WHERE id = ?', 
        [id]
      );
      
      return rows[0];
      
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async getTransaction(transactionId) {
    try {
      const [rows] = await pool.execute(
        'SELECT * FROM transactions WHERE id = ?', 
        [transactionId]
      );
      return rows[0] || null;
    } catch (error) {
      log('Error getting transaction:', error.message);
      throw error;
    }
  }

  static async updatePaymentStatus(transactionId, paymentData) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { status, requestId, responseCode, customerPhone, paymentResponse, callbackProcessed = true } = paymentData;
      
      await connection.execute(`
        UPDATE transactions SET 
          status = ?, 
          mpaisa_request_id = ?, 
          mpaisa_response_code = ?, 
          customer_phone_number = ?, 
          payment_response = ?,
          payment_completed_at = CURRENT_TIMESTAMP,
          callback_processed = ?
        WHERE id = ?
      `, [status, requestId, responseCode, customerPhone, JSON.stringify(paymentResponse), callbackProcessed, transactionId]);

      // Add history entry
      await connection.execute(`
        INSERT INTO transaction_history (transaction_id, status, details)
        VALUES (?, ?, ?)
      `, [transactionId, status, JSON.stringify(paymentData)]);

      await connection.commit();

      // Get updated transaction
      const [rows] = await connection.execute(
        'SELECT * FROM transactions WHERE id = ?', 
        [transactionId]
      );
      
      return rows[0];
      
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async updateAuthStatus(transactionId, authData) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const { attempted, success, response, logonUrl, error } = authData;
      
      await connection.execute(`
        UPDATE transactions SET 
          auth_attempted = ?, 
          auth_success = ?, 
          auth_response = ?, 
          auth_logon_url = ?, 
          auth_error = ?,
          auth_completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [attempted, success, JSON.stringify(response), logonUrl, error, transactionId]);

      // Add history entry
      const historyStatus = `auth_${success ? 'success' : 'failed'}`;
      await connection.execute(`
        INSERT INTO transaction_history (transaction_id, status, details)
        VALUES (?, ?, ?)
      `, [transactionId, historyStatus, JSON.stringify(authData)]);

      await connection.commit();

      // Get updated transaction
      const [rows] = await connection.execute(
        'SELECT * FROM transactions WHERE id = ?', 
        [transactionId]
      );
      
      return rows[0];
      
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async updateTransactionVoucher(transactionId, voucherCode) {
    try {
      await pool.execute(`
        UPDATE transactions 
        SET voucher_code = ?
        WHERE id = ?
      `, [voucherCode, transactionId]);

      log(`Updated transaction ${transactionId} with voucher code: ${voucherCode}`);
      
      // Get updated transaction
      const [rows] = await pool.execute(
        'SELECT * FROM transactions WHERE id = ?', 
        [transactionId]
      );
      
      return rows[0];
    } catch (error) {
      log('Error updating transaction voucher:', error.message);
      throw error;
    }
  }

  // 🔥 NEW: Manual assistance methods
  static async createManualAssistanceCase(caseData) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const {
        transactionId,
        sessionId,
        customerPhone,
        customerIp,
        planId,
        amountPaid,
        paymentCompletedAt,
        voucherCode,
        authFailureReason,
        authResponse,
        ruijieErrorMessage
      } = caseData;

      // Insert manual assistance case
      const [result] = await connection.execute(`
        INSERT INTO manual_assistance_required (
          transaction_id, session_id, customer_phone, customer_ip,
          plan_id, amount_paid, payment_completed_at, voucher_code,
          auth_failure_reason, auth_response, ruijie_error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        transactionId, sessionId, customerPhone, customerIp,
        planId, amountPaid, paymentCompletedAt, voucherCode,
        authFailureReason, JSON.stringify(authResponse), ruijieErrorMessage
      ]);

      // Add transaction history entry
      await connection.execute(`
        INSERT INTO transaction_history (transaction_id, status, details)
        VALUES (?, ?, ?)
      `, [transactionId, 'manual_assistance_required', JSON.stringify({
        reason: 'Payment successful but authentication failed',
        caseId: result.insertId,
        ruijieError: ruijieErrorMessage
      })]);

      await connection.commit();

      log(`🚨 URGENT: Manual assistance case #${result.insertId} created for transaction ${transactionId}`);
      log(`    Customer: ${customerPhone}, Plan: ${planId}, Amount: $${amountPaid}`);
      log(`    Reason: ${ruijieErrorMessage || authFailureReason}`);

      return {
        caseId: result.insertId,
        transactionId,
        created: true
      };

    } catch (error) {
      await connection.rollback();
      log('XXXX Error creating manual assistance case:', error.message);
      throw error;
    } finally {
      connection.release();
    }
  }

  static async getUrgentCases(limit = 50) {
    try {
      const [rows] = await pool.execute(`
        SELECT * FROM manual_assistance_required
        WHERE status IN ('PENDING', 'CONTACTED', 'IN_PROGRESS')
        ORDER BY created_at ASC
        LIMIT ?
      `, [limit]);

      return rows;
    } catch (error) {
      log('Error getting urgent cases:', error.message);
      throw error;
    }
  }

  static async updateAssistanceCase(caseId, updateData) {
    try {
      const { status, resolutionNotes } = updateData;
      
      let query = 'UPDATE manual_assistance_required SET updated_at = NOW()';
      let params = [];
      
      if (status) {
        query += ', status = ?';
        params.push(status);
        
        if (status === 'RESOLVED') {
          query += ', resolved_at = NOW()';
        }
      }
      
      if (resolutionNotes) {
        query += ', resolution_notes = ?';
        params.push(resolutionNotes);
      }
      
      query += ' WHERE id = ?';
      params.push(caseId);
      
      await pool.execute(query, params);
      
      const [rows] = await pool.execute('SELECT * FROM manual_assistance_required WHERE id = ?', [caseId]);
      return rows[0];
      
    } catch (error) {
      log('Error updating assistance case:', error.message);
      throw error;
    }
  }

  static async acquireProcessingLock(transactionId) {
    try {
      // Clean up expired locks first
      await pool.execute(
        'DELETE FROM processing_locks WHERE expires_at < NOW()'
      );
      
      const processId = `${process.pid}_${Date.now()}`;
      
      const [result] = await pool.execute(`
        INSERT IGNORE INTO processing_locks (transaction_id, process_id, expires_at)
        VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))
      `, [transactionId, processId]);
      
      return result.affectedRows > 0; // Returns true if lock was acquired
      
    } catch (error) {
      log('Error acquiring processing lock:', error.message);
      return false;
    }
  }

  static async releaseProcessingLock(transactionId) {
    try {
      await pool.execute(
        'DELETE FROM processing_locks WHERE transaction_id = ?',
        [transactionId]
      );
    } catch (error) {
      log('Error releasing processing lock:', error.message);
    }
  }

  static async isProcessingLocked(transactionId) {
    try {
      const [rows] = await pool.execute(`
        SELECT COUNT(*) as count FROM processing_locks 
        WHERE transaction_id = ? AND expires_at > NOW()
      `, [transactionId]);
      
      return rows[0].count > 0;
    } catch (error) {
      log('Error checking processing lock:', error.message);
      return false;
    }
  }

  static async getTransactionHistory(transactionId) {
    try {
      const [rows] = await pool.execute(`
        SELECT * FROM transaction_history 
        WHERE transaction_id = ? 
        ORDER BY created_at ASC
      `, [transactionId]);
      
      return rows;
    } catch (error) {
      log('Error getting transaction history:', error.message);
      throw error;
    }
  }

  // Session operations
  static async createOrUpdateSession(sessionData) {
    try {
      const { sessionId, clientIp, clientMac, userAgent } = sessionData;

      await pool.execute(`
        INSERT INTO sessions (session_id, client_ip, client_mac, user_agent)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          client_ip = VALUES(client_ip),
          client_mac = COALESCE(VALUES(client_mac), client_mac),
          user_agent = VALUES(user_agent),
          last_activity = CURRENT_TIMESTAMP
      `, [sessionId, clientIp, clientMac || null, userAgent]);

      const [rows] = await pool.execute(
        'SELECT * FROM sessions WHERE session_id = ?',
        [sessionId]
      );

      return rows[0];
    } catch (error) {
      log('Error creating/updating session:', error.message);
      throw error;
    }
  }

  static async getSession(sessionId) {
    try {
      const [rows] = await pool.execute(
        'SELECT * FROM sessions WHERE session_id = ?',
        [sessionId]
      );
      return rows[0] || null;
    } catch (error) {
      log('Error getting session:', error.message);
      throw error;
    }
  }

  static async updateSessionAuth(sessionId, authData) {
    try {
      const { isAuthenticated, voucherCode, logonUrl } = authData;
      
      await pool.execute(`
        UPDATE sessions SET 
          is_authenticated = ?, 
          voucher_code = ?, 
          logon_url = ?
        WHERE session_id = ?
      `, [isAuthenticated, voucherCode, logonUrl, sessionId]);

      const [rows] = await pool.execute(
        'SELECT * FROM sessions WHERE session_id = ?',
        [sessionId]
      );
      
      return rows[0];
    } catch (error) {
      log('Error updating session auth:', error.message);
      throw error;
    }
  }

  // Analytics and reporting
  static async getTransactionStats() {
    try {
      const [rows] = await pool.execute(`
        SELECT 
          status, 
          COUNT(*) as count, 
          AVG(amount) as avg_amount,
          SUM(amount) as total_amount
        FROM transactions 
        GROUP BY status
        ORDER BY count DESC
      `);
      
      return rows;
    } catch (error) {
      log('Error getting transaction stats:', error.message);
      throw error;
    }
  }

  static async getRecentTransactions(limit = 50) {
    try {
      const [rows] = await pool.execute(`
        SELECT * FROM transactions 
        ORDER BY created_at DESC 
        LIMIT ?
      `, [limit]);
      
      return rows;
    } catch (error) {
      log('Error getting recent transactions:', error.message);
      throw error;
    }
  }

  // Utility methods
  static async cleanup() {
    try {
      const [result] = await pool.execute(
        'DELETE FROM processing_locks WHERE expires_at < NOW()'
      );
      
      if (result.affectedRows > 0) {
        log(`Cleaned up ${result.affectedRows} expired locks`);
      }
    } catch (error) {
      log('Error during cleanup:', error.message);
    }
  }

  // Database maintenance
  static async getTableSizes() {
    try {
      const [rows] = await pool.execute(`
        SELECT 
          TABLE_NAME as table_name,
          ROUND(((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024), 2) as size_mb,
          TABLE_ROWS as row_count
        FROM information_schema.TABLES 
        WHERE TABLE_SCHEMA = ?
      `, [process.env.DB_NAME || 'wifi_payment_portal']);
      
      return rows;
    } catch (error) {
      log('Error getting table sizes:', error.message);
      throw error;
    }
  }

  static async optimizeTables() {
    try {
      const tables = ['transactions', 'sessions', 'transaction_history', 'processing_locks', 'manual_assistance_required'];
      
      for (const table of tables) {
        await pool.execute(`OPTIMIZE TABLE ${table}`);
        log(`Optimized table: ${table}`);
      }
      
      return true;
    } catch (error) {
      log('Error optimizing tables:', error.message);
      throw error;
    }
  }
}

// Initialize database and test connection on startup
const initialize = async () => {
  try {
    const connected = await testConnection();
    if (!connected) {
      throw new Error('Could not connect to MySQL database');
    }
    
    await initializeDatabase();
    
    // Start periodic cleanup (every 5 minutes)
    setInterval(async () => {
      await TransactionDB.cleanup();
    }, 5 * 60 * 1000);
    
    log('✓ Database system ready');
    
  } catch (error) {
    log('✗ Database initialization failed:', error.message);
    throw error;
  }
};

// Graceful shutdown
const shutdown = async () => {
  try {
    await pool.end();
    log('✓ Database connections closed');
  } catch (error) {
    log('✗ Error closing database connections:', error.message);
  }
};

// Handle application shutdown
process.on('SIGINT', async () => {
  await shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await shutdown();
  process.exit(0);
});

// Initialize database on module load
initialize().catch(error => {
  console.error('Failed to initialize database:', error);
  process.exit(1);
});

module.exports = {
  pool,
  TransactionDB,
  testConnection,
  initialize,
  shutdown
};