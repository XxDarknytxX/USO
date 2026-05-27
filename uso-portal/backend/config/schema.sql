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

  -- Indexes for performance
  INDEX idx_last_activity (last_activity),
  INDEX idx_is_authenticated (is_authenticated),
  INDEX idx_portal_entry (portal_entry_time),
  INDEX idx_client_mac (client_mac)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 2. TRANSACTIONS TABLE
-- Core payment and authentication tracking
-- ============================================
CREATE TABLE IF NOT EXISTS transactions (
  id VARCHAR(255) PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  plan_id VARCHAR(100) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  voucher_code VARCHAR(100) NULL,
  status VARCHAR(50) DEFAULT 'initiated',
  
  -- M-PAiSA Payment Gateway Fields
  mpaisa_request_id VARCHAR(255) NULL,
  mpaisa_response_code VARCHAR(10) NULL,
  customer_phone_number VARCHAR(20) NULL,
  payment_response TEXT NULL,
  
  -- Voucher Authentication Fields
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
  
  -- Client Metadata
  client_ip VARCHAR(45) NULL,
  client_mac VARCHAR(17) NULL,
  user_agent TEXT NULL,
  callback_processed BOOLEAN DEFAULT FALSE,

  -- Indexes for performance
  INDEX idx_session_id (session_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at),
  INDEX idx_payment_completed (payment_completed_at),
  INDEX idx_plan_id (plan_id),
  INDEX idx_auth_success (auth_success),
  INDEX idx_callback_processed (callback_processed),
  INDEX idx_client_mac (client_mac),
  
  -- Foreign key relationship
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 3. TRANSACTION_HISTORY TABLE
-- Audit trail for all transaction changes
-- ============================================
CREATE TABLE IF NOT EXISTS transaction_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  transaction_id VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL,
  details TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes for performance
  INDEX idx_transaction_id (transaction_id),
  INDEX idx_created_at (created_at),
  INDEX idx_status (status),
  
  -- Foreign key relationship
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 4. PROCESSING_LOCKS TABLE
-- Prevents concurrent processing of callbacks
-- ============================================
CREATE TABLE IF NOT EXISTS processing_locks (
  transaction_id VARCHAR(255) PRIMARY KEY,
  locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  process_id VARCHAR(100) NULL,
  expires_at TIMESTAMP NULL,
  
  -- Indexes for performance
  INDEX idx_expires_at (expires_at),
  INDEX idx_locked_at (locked_at),
  
  -- Foreign key relationship
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 5. MANUAL_ASSISTANCE_REQUIRED TABLE
-- Tracks paid customers who didn't get authenticated
-- Simplified: PENDING → RESOLVED only
-- ============================================
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
  
  -- Status (simplified)
  status ENUM('PENDING', 'RESOLVED') DEFAULT 'PENDING',
  
  -- Resolution Tracking
  resolved_at TIMESTAMP NULL,
  resolution_notes TEXT NULL,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Indexes (simplified)
  INDEX idx_status (status),
  INDEX idx_created_at (created_at),
  INDEX idx_customer_phone (customer_phone),
  INDEX idx_transaction_id (transaction_id),
  
  -- Foreign keys
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
