/**
 * File: src/components/AuthHandler.jsx
 * Purpose: Handles payment callback routing and URL parameter detection
 * Features: Detects payment parameters and redirects to appropriate payment result page
 */

import { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

export default function AuthHandler({ children }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    // Detect payment return parameters
    const transactionId = searchParams.get('tID');
    const responseCode = searchParams.get('rCode');
    const paymentStatus = searchParams.get('status');
    
    // If we have payment-related parameters, redirect to payment result page
    if (transactionId || responseCode || paymentStatus) {
      // Preserve both query string and hash when redirecting
      const search = window.location.search;
      const hash = window.location.hash || '';
      navigate(`/payment-result${search}${hash}`, { replace: true });
    }
  }, [searchParams, navigate]);

  return children;
}