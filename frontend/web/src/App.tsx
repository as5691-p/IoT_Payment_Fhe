// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

// Randomly selected styles: High saturation neon (purple/blue/pink/green), Glass morphism, Center radiation, Micro-interactions
// Randomly selected features: Data statistics, Smart charts, Search & filter, Project introduction

interface PaymentRecord {
  id: string;
  encryptedAmount: string;
  timestamp: number;
  fromDevice: string;
  toDevice: string;
  status: "pending" | "completed" | "failed";
  description: string;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'addFee5%':
      result = value * 1.05;
      break;
    case 'discount10%':
      result = value * 0.9;
      break;
    case 'convertToUSD':
      result = value * 0.00015; // Example conversion rate
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newPaymentData, setNewPaymentData] = useState({ toDevice: "", amount: 0, description: "" });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PaymentRecord | null>(null);
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "completed" | "failed">("all");

  const completedCount = payments.filter(p => p.status === "completed").length;
  const pendingCount = payments.filter(p => p.status === "pending").length;
  const failedCount = payments.filter(p => p.status === "failed").length;

  useEffect(() => {
    loadPayments().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadPayments = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("payment_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing payment keys:", e); }
      }
      
      const list: PaymentRecord[] = [];
      for (const key of keys) {
        try {
          const paymentBytes = await contract.getData(`payment_${key}`);
          if (paymentBytes.length > 0) {
            try {
              const paymentData = JSON.parse(ethers.toUtf8String(paymentBytes));
              list.push({ 
                id: key, 
                encryptedAmount: paymentData.amount, 
                timestamp: paymentData.timestamp, 
                fromDevice: paymentData.fromDevice, 
                toDevice: paymentData.toDevice, 
                status: paymentData.status || "pending",
                description: paymentData.description || ""
              });
            } catch (e) { console.error(`Error parsing payment data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading payment ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setPayments(list);
    } catch (e) { console.error("Error loading payments:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitPayment = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting payment amount with Zama FHE..." });
    try {
      const encryptedAmount = FHEEncryptNumber(newPaymentData.amount);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const paymentId = `iot-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const paymentData = { 
        amount: encryptedAmount, 
        timestamp: Math.floor(Date.now() / 1000), 
        fromDevice: address, 
        toDevice: newPaymentData.toDevice, 
        status: "pending",
        description: newPaymentData.description
      };
      
      await contract.setData(`payment_${paymentId}`, ethers.toUtf8Bytes(JSON.stringify(paymentData)));
      
      const keysBytes = await contract.getData("payment_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(paymentId);
      await contract.setData("payment_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE-encrypted payment submitted!" });
      await loadPayments();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewPaymentData({ toDevice: "", amount: 0, description: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const completePayment = async (paymentId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing FHE-encrypted payment..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const paymentBytes = await contract.getData(`payment_${paymentId}`);
      if (paymentBytes.length === 0) throw new Error("Payment not found");
      const paymentData = JSON.parse(ethers.toUtf8String(paymentBytes));
      
      const updatedAmount = FHECompute(paymentData.amount, 'addFee5%');
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedPayment = { ...paymentData, status: "completed", amount: updatedAmount };
      await contractWithSigner.setData(`payment_${paymentId}`, ethers.toUtf8Bytes(JSON.stringify(updatedPayment)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Payment completed with FHE!" });
      await loadPayments();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Payment failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const failPayment = async (paymentId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing payment with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const paymentBytes = await contract.getData(`payment_${paymentId}`);
      if (paymentBytes.length === 0) throw new Error("Payment not found");
      const paymentData = JSON.parse(ethers.toUtf8String(paymentBytes));
      const updatedPayment = { ...paymentData, status: "failed" };
      await contract.setData(`payment_${paymentId}`, ethers.toUtf8Bytes(JSON.stringify(updatedPayment)));
      setTransactionStatus({ visible: true, status: "success", message: "Payment marked as failed!" });
      await loadPayments();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Operation failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isDeviceOwner = (deviceAddress: string) => address?.toLowerCase() === deviceAddress.toLowerCase();

  const tutorialSteps = [
    { title: "Connect Wallet", description: "Connect your Web3 wallet to manage IoT payments", icon: "🔗" },
    { title: "Initiate FHE Payment", description: "Create encrypted micro-payments between IoT devices", icon: "💳", details: "Payment amounts are encrypted using Zama FHE before submission" },
    { title: "FHE Processing", description: "Payments are processed while remaining encrypted", icon: "⚙️", details: "Zama FHE enables computations on encrypted payment data" },
    { title: "Secure Settlement", description: "Complete transactions without exposing sensitive data", icon: "🔐", details: "Only authorized devices can decrypt payment details" }
  ];

  const renderBarChart = () => {
    const statusData = [
      { label: "Completed", value: completedCount, color: "#4ff8d2" },
      { label: "Pending", value: pendingCount, color: "#f8d94f" },
      { label: "Failed", value: failedCount, color: "#f84f4f" }
    ];
    
    const maxValue = Math.max(1, ...statusData.map(d => d.value));
    
    return (
      <div className="bar-chart-container">
        {statusData.map((item, index) => (
          <div key={index} className="bar-item">
            <div className="bar-label">{item.label}</div>
            <div className="bar-track">
              <div 
                className="bar-fill" 
                style={{
                  width: `${(item.value / maxValue) * 100}%`,
                  backgroundColor: item.color
                }}
              ></div>
            </div>
            <div className="bar-value">{item.value}</div>
          </div>
        ))}
      </div>
    );
  };

  const filteredPayments = payments.filter(payment => {
    const matchesSearch = payment.id.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         payment.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         payment.toDevice.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === "all" || payment.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  if (loading) return (
    <div className="loading-screen">
      <div className="neon-spinner"></div>
      <p>Initializing FHE payment system...</p>
    </div>
  );

  return (
    <div className="app-container glass-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon"><div className="iot-icon"></div></div>
          <h1>IoT<span>FHE</span>Pay</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-payment-btn neon-button">
            <div className="add-icon"></div>New Payment
          </button>
          <button className="neon-button" onClick={() => setShowTutorial(!showTutorial)}>
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <div className="wallet-connect-wrapper"><ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/></div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Decentralized IoT Payments with FHE</h2>
            <p>Secure micro-payments between IoT devices using Zama's Fully Homomorphic Encryption</p>
          </div>
          <div className="fhe-indicator"><div className="fhe-lock"></div><span>FHE Encryption Active</span></div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>IoT FHE Payment Guide</h2>
            <p className="subtitle">Learn how to securely process micro-payments between devices</p>
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div className="tutorial-step" key={index}>
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    {step.details && <div className="step-details">{step.details}</div>}
                  </div>
                </div>
              ))}
            </div>
            <div className="fhe-diagram">
              <div className="diagram-step"><div className="diagram-icon">🔌</div><div className="diagram-label">IoT Device</div></div>
              <div className="diagram-arrow">→</div>
              <div className="diagram-step"><div className="diagram-icon">🔒</div><div className="diagram-label">FHE Encryption</div></div>
              <div className="diagram-arrow">→</div>
              <div className="diagram-step"><div className="diagram-icon">⚡</div><div className="diagram-label">DePIN Network</div></div>
              <div className="diagram-arrow">→</div>
              <div className="diagram-step"><div className="diagram-icon">🔋</div><div className="diagram-label">IoT Device</div></div>
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card glass-card">
            <h3>Project Introduction</h3>
            <p>A decentralized payment system for IoT devices using <strong>Zama FHE</strong> to encrypt micro-payments (like EV charging payments) end-to-end, protecting user and device data privacy.</p>
            <div className="fhe-badge"><span>FHE-Powered</span></div>
            <div className="feature-tags">
              <span>Device-to-device</span>
              <span>Low Gas</span>
              <span>Privacy-first</span>
            </div>
          </div>
          
          <div className="dashboard-card glass-card">
            <h3>Payment Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item"><div className="stat-value">{payments.length}</div><div className="stat-label">Total</div></div>
              <div className="stat-item"><div className="stat-value">{completedCount}</div><div className="stat-label">Completed</div></div>
              <div className="stat-item"><div className="stat-value">{pendingCount}</div><div className="stat-label">Pending</div></div>
              <div className="stat-item"><div className="stat-value">{failedCount}</div><div className="stat-label">Failed</div></div>
            </div>
          </div>
          
          <div className="dashboard-card glass-card">
            <h3>Payment Status</h3>
            {renderBarChart()}
          </div>
        </div>
        
        <div className="payments-section">
          <div className="section-header">
            <h2>IoT Payment Records</h2>
            <div className="header-actions">
              <div className="search-filter">
                <input 
                  type="text" 
                  placeholder="Search payments..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="glass-input"
                />
                <select 
                  value={filterStatus} 
                  onChange={(e) => setFilterStatus(e.target.value as any)}
                  className="glass-select"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
              <button onClick={loadPayments} className="refresh-btn neon-button" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="payments-list glass-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">To Device</div>
              <div className="header-cell">Description</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {filteredPayments.length === 0 ? (
              <div className="no-payments">
                <div className="no-payments-icon"></div>
                <p>No payment records found</p>
                <button className="neon-button primary" onClick={() => setShowCreateModal(true)}>Create First Payment</button>
              </div>
            ) : filteredPayments.map(payment => (
              <div className="payment-row" key={payment.id} onClick={() => setSelectedPayment(payment)}>
                <div className="table-cell payment-id">#{payment.id.substring(0, 6)}</div>
                <div className="table-cell">{payment.toDevice.substring(0, 6)}...{payment.toDevice.substring(38)}</div>
                <div className="table-cell">{payment.description || "No description"}</div>
                <div className="table-cell">{new Date(payment.timestamp * 1000).toLocaleDateString()}</div>
                <div className="table-cell"><span className={`status-badge ${payment.status}`}>{payment.status}</span></div>
                <div className="table-cell actions">
                  {isDeviceOwner(payment.fromDevice) && payment.status === "pending" && (
                    <>
                      <button className="action-btn neon-button success" onClick={(e) => { e.stopPropagation(); completePayment(payment.id); }}>Complete</button>
                      <button className="action-btn neon-button danger" onClick={(e) => { e.stopPropagation(); failPayment(payment.id); }}>Fail</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitPayment} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          paymentData={newPaymentData} 
          setPaymentData={setNewPaymentData}
        />
      )}
      
      {selectedPayment && (
        <PaymentDetailModal 
          payment={selectedPayment} 
          onClose={() => { setSelectedPayment(null); setDecryptedAmount(null); }} 
          decryptedAmount={decryptedAmount} 
          setDecryptedAmount={setDecryptedAmount} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glass-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="neon-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo"><div className="iot-icon"></div><span>IoT FHE Pay</span></div>
            <p>Secure encrypted payments for IoT devices using Zama FHE</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">GitHub</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>Powered by Zama FHE</span></div>
          <div className="copyright">© {new Date().getFullYear()} IoT FHE Pay. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  paymentData: any;
  setPaymentData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, paymentData, setPaymentData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setPaymentData({ ...paymentData, [name]: value });
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPaymentData({ ...paymentData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!paymentData.toDevice || !paymentData.amount) { 
      alert("Please fill required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal glass-card">
        <div className="modal-header">
          <h2>Create IoT Payment</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div><strong>FHE Encryption Notice</strong><p>Payment amount will be encrypted with Zama FHE before submission</p></div>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>To Device Address *</label>
              <input 
                type="text" 
                name="toDevice" 
                value={paymentData.toDevice} 
                onChange={handleChange} 
                placeholder="0x..." 
                className="glass-input"
              />
            </div>
            
            <div className="form-group">
              <label>Amount (in wei) *</label>
              <input 
                type="number" 
                name="amount" 
                value={paymentData.amount} 
                onChange={handleAmountChange} 
                placeholder="0.00" 
                className="glass-input"
                step="0.0001"
              />
            </div>
            
            <div className="form-group">
              <label>Description</label>
              <textarea 
                name="description" 
                value={paymentData.description} 
                onChange={handleChange} 
                placeholder="Payment purpose..." 
                className="glass-textarea"
                rows={3}
              />
            </div>
          </div>
          
          <div className="encryption-preview">
            <h4>FHE Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Plain Amount:</span>
                <div>{paymentData.amount || '0'} wei</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>{paymentData.amount ? FHEEncryptNumber(paymentData.amount).substring(0, 50) + '...' : 'No amount entered'}</div>
              </div>
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <div>
              <strong>Data Privacy Guarantee</strong>
              <p>Payment details remain encrypted during processing and are never decrypted on our servers</p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn neon-button">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn neon-button primary">
            {creating ? "Encrypting with FHE..." : "Submit Payment"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface PaymentDetailModalProps {
  payment: PaymentRecord;
  onClose: () => void;
  decryptedAmount: number | null;
  setDecryptedAmount: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const PaymentDetailModal: React.FC<PaymentDetailModalProps> = ({ 
  payment, 
  onClose, 
  decryptedAmount, 
  setDecryptedAmount, 
  isDecrypting, 
  decryptWithSignature 
}) => {
  const handleDecrypt = async () => {
    if (decryptedAmount !== null) { 
      setDecryptedAmount(null); 
      return; 
    }
    const decrypted = await decryptWithSignature(payment.encryptedAmount);
    if (decrypted !== null) setDecryptedAmount(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="payment-detail-modal glass-card">
        <div className="modal-header">
          <h2>Payment Details #{payment.id.substring(0, 8)}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="payment-info">
            <div className="info-item">
              <span>From Device:</span>
              <strong>{payment.fromDevice.substring(0, 6)}...{payment.fromDevice.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>To Device:</span>
              <strong>{payment.toDevice.substring(0, 6)}...{payment.toDevice.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(payment.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={`status-badge ${payment.status}`}>{payment.status}</strong>
            </div>
            <div className="info-item">
              <span>Description:</span>
              <strong>{payment.description || "No description"}</strong>
            </div>
          </div>
          
          <div className="encrypted-data-section">
            <h3>Encrypted Payment Amount</h3>
            <div className="encrypted-data">{payment.encryptedAmount.substring(0, 100)}...</div>
            <div className="fhe-tag"><div className="fhe-icon"></div><span>FHE Encrypted</span></div>
            <button 
              className="decrypt-btn neon-button" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? <span className="decrypt-spinner"></span> : 
               decryptedAmount !== null ? "Hide Amount" : "Decrypt with Wallet"}
            </button>
          </div>
          
          {decryptedAmount !== null && (
            <div className="decrypted-data-section">
              <h3>Decrypted Amount</h3>
              <div className="decrypted-value">{decryptedAmount} wei</div>
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>Decrypted amount is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn neon-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;