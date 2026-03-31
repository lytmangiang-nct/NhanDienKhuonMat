/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  serverTimestamp,
  getDocFromServer,
  doc
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut, 
  User 
} from 'firebase/auth';
import { db, auth } from './firebase';
import { GoogleGenAI } from "@google/genai";
import Webcam from "react-webcam";
import { 
  Camera, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  LogOut, 
  Plus, 
  History, 
  User as UserIcon,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

// --- Types ---
interface GatePass {
  id?: string;
  fullName: string;
  department: string;
  reason: string;
  exitTime: string;
  photoUrl: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: any;
  uid: string;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: any[];
  }
}

// --- Error Handling ---
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- App Component ---
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [passes, setPasses] = useState<GatePass[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    department: '',
    reason: '',
    exitTime: new Date().toISOString().slice(0, 16)
  });
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const webcamRef = useRef<Webcam>(null);

  // --- Auth & Initial Load ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'gatepasses'),
      where('uid', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GatePass));
      setPasses(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'gatepasses');
    });

    return () => unsubscribe();
  }, [user]);

  // Test connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  // --- Handlers ---
  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const capture = useCallback(() => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) {
      setCapturedImage(imageSrc);
      verifyFace(imageSrc);
    }
  }, [webcamRef]);

  const verifyFace = async (imageSrc: string) => {
    setIsVerifying(true);
    setVerificationResult(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = "gemini-3-flash-preview";
      
      const base64Data = imageSrc.split(',')[1];
      
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            parts: [
              { text: "Analyze this image. Is there a clear human face present? Respond in JSON format with 'success' (boolean) and 'message' (string in Vietnamese). If it's a face, success is true. If not, success is false and explain why (e.g., too dark, no face, blurry)." },
              { inlineData: { mimeType: "image/jpeg", data: base64Data } }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });

      const result = JSON.parse(response.text || '{"success": false, "message": "Không thể xác minh."}');
      setVerificationResult(result);
    } catch (error) {
      console.error("Verification failed", error);
      setVerificationResult({ success: false, message: "Lỗi kết nối AI." });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !capturedImage || !verificationResult?.success) return;

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'gatepasses'), {
        ...formData,
        photoUrl: capturedImage,
        status: 'pending',
        createdAt: serverTimestamp(),
        uid: user.uid
      });
      setIsCreating(false);
      setCapturedImage(null);
      setVerificationResult(null);
      setFormData({
        fullName: '',
        department: '',
        reason: '',
        exitTime: new Date().toISOString().slice(0, 16)
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'gatepasses');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#151619] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#151619] flex flex-col items-center justify-center p-6 text-white font-mono">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-[#1c1d21] border border-[#2d2e33] rounded-xl p-8 shadow-2xl text-center"
        >
          <div className="w-16 h-16 bg-[#2d2e33] rounded-full flex items-center justify-center mx-auto mb-6">
            <ShieldCheck className="w-8 h-8 text-[#00FF00]" />
          </div>
          <h1 className="text-2xl font-bold mb-2 tracking-tight">GATEPASS AI</h1>
          <p className="text-[#8E9299] text-sm mb-8">Hệ thống xác minh ra cổng thông minh</p>
          
          <button 
            onClick={handleLogin}
            className="w-full bg-white text-black font-bold py-3 px-6 rounded-lg hover:bg-[#E6E6E6] transition-colors flex items-center justify-center gap-2"
          >
            <img src="https://www.google.com/favicon.ico" className="w-4 h-4" alt="Google" />
            Đăng nhập với Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-mono selection:bg-[#00FF00] selection:text-black">
      {/* Header */}
      <header className="border-bottom border-[#1c1d21] bg-[#0a0a0a]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#00FF00] rounded flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-black" />
            </div>
            <span className="font-bold tracking-widest text-sm">GATEPASS.SYS</span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-[10px] text-[#8E9299] uppercase tracking-widest">Operator</span>
              <span className="text-xs font-bold">{user.displayName}</span>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 hover:bg-[#1c1d21] rounded-lg transition-colors text-[#8E9299] hover:text-white"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Actions & List */}
          <div className="lg:col-span-7 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <History className="w-5 h-5 text-[#00FF00]" />
                LỊCH SỬ RA CỔNG
              </h2>
              <button 
                onClick={() => setIsCreating(!isCreating)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all",
                  isCreating ? "bg-[#1c1d21] text-white" : "bg-[#00FF00] text-black hover:bg-[#00CC00]"
                )}
              >
                {isCreating ? <XCircle className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {isCreating ? "HỦY BỎ" : "TẠO PHIẾU MỚI"}
              </button>
            </div>

            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {passes.length === 0 ? (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="border border-dashed border-[#2d2e33] rounded-xl p-12 text-center text-[#8E9299]"
                  >
                    Chưa có dữ liệu phiếu ra cổng.
                  </motion.div>
                ) : (
                  passes.map((pass) => (
                    <motion.div
                      key={pass.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="bg-[#151619] border border-[#1c1d21] rounded-xl p-4 flex items-center gap-4 hover:border-[#2d2e33] transition-colors"
                    >
                      <div className="w-12 h-12 rounded-lg overflow-hidden bg-[#1c1d21] flex-shrink-0">
                        <img src={pass.photoUrl} alt="Face" className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-grow min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h3 className="font-bold text-sm truncate">{pass.fullName}</h3>
                          <span className={cn(
                            "text-[10px] px-2 py-0.5 rounded uppercase font-bold",
                            pass.status === 'approved' ? "bg-[#00FF00]/10 text-[#00FF00]" :
                            pass.status === 'rejected' ? "bg-red-500/10 text-red-500" :
                            "bg-yellow-500/10 text-yellow-500"
                          )}>
                            {pass.status}
                          </span>
                        </div>
                        <p className="text-[#8E9299] text-[10px] uppercase tracking-wider mb-1">
                          {pass.department} • {pass.reason}
                        </p>
                        <p className="text-[#8E9299] text-[10px]">
                          {new Date(pass.exitTime).toLocaleString('vi-VN')}
                        </p>
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Right Column: Form (Conditional) */}
          <div className="lg:col-span-5">
            <AnimatePresence>
              {isCreating && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-[#151619] border border-[#1c1d21] rounded-xl overflow-hidden shadow-2xl sticky top-24"
                >
                  <div className="p-4 border-b border-[#1c1d21] bg-[#1c1d21]/50">
                    <h2 className="text-sm font-bold tracking-widest uppercase flex items-center gap-2">
                      <Plus className="w-4 h-4 text-[#00FF00]" />
                      ĐĂNG KÝ RA CỔNG
                    </h2>
                  </div>

                  <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {/* Camera Section */}
                    <div className="space-y-3">
                      <label className="text-[10px] text-[#8E9299] uppercase tracking-widest block">Xác minh khuôn mặt</label>
                      <div className="relative aspect-video bg-black rounded-lg overflow-hidden border border-[#2d2e33]">
                        {!capturedImage ? (
                          <>
                            <Webcam
                              audio={false}
                              ref={webcamRef}
                              screenshotFormat="image/jpeg"
                              className="w-full h-full object-cover"
                              videoConstraints={{ facingMode: "user" }}
                            />
                            <div className="absolute inset-0 border-2 border-dashed border-[#00FF00]/30 pointer-events-none" />
                            <button
                              type="button"
                              onClick={capture}
                              className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-[#00FF00] text-black p-3 rounded-full hover:scale-110 transition-transform shadow-lg"
                            >
                              <Camera className="w-6 h-6" />
                            </button>
                          </>
                        ) : (
                          <div className="relative w-full h-full">
                            <img src={capturedImage} className="w-full h-full object-cover" alt="Captured" />
                            <button
                              type="button"
                              onClick={() => {
                                setCapturedImage(null);
                                setVerificationResult(null);
                              }}
                              className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-black rounded-full transition-colors"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                            
                            {/* Verification Overlay */}
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
                              {isVerifying ? (
                                <div className="flex flex-col items-center gap-2">
                                  <Loader2 className="w-8 h-8 text-[#00FF00] animate-spin" />
                                  <span className="text-[10px] font-bold tracking-widest">ĐANG XÁC MINH...</span>
                                </div>
                              ) : verificationResult ? (
                                <motion.div 
                                  initial={{ scale: 0.8, opacity: 0 }}
                                  animate={{ scale: 1, opacity: 1 }}
                                  className={cn(
                                    "flex flex-col items-center gap-2 p-4 rounded-xl text-center max-w-[80%]",
                                    verificationResult.success ? "bg-[#00FF00]/20 border border-[#00FF00]/50" : "bg-red-500/20 border border-red-500/50"
                                  )}
                                >
                                  {verificationResult.success ? (
                                    <CheckCircle2 className="w-8 h-8 text-[#00FF00]" />
                                  ) : (
                                    <AlertCircle className="w-8 h-8 text-red-500" />
                                  )}
                                  <p className="text-xs font-bold leading-tight">{verificationResult.message}</p>
                                </motion.div>
                              ) : null}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Form Fields */}
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-[#8E9299] uppercase tracking-widest">Họ và tên</label>
                        <input
                          required
                          type="text"
                          value={formData.fullName}
                          onChange={(e) => setFormData({...formData, fullName: e.target.value})}
                          className="w-full bg-[#0a0a0a] border border-[#2d2e33] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#00FF00] transition-colors"
                          placeholder="Nguyễn Văn A"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] text-[#8E9299] uppercase tracking-widest">Bộ phận</label>
                          <input
                            required
                            type="text"
                            value={formData.department}
                            onChange={(e) => setFormData({...formData, department: e.target.value})}
                            className="w-full bg-[#0a0a0a] border border-[#2d2e33] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#00FF00] transition-colors"
                            placeholder="Kỹ thuật"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] text-[#8E9299] uppercase tracking-widest">Thời gian ra</label>
                          <input
                            required
                            type="datetime-local"
                            value={formData.exitTime}
                            onChange={(e) => setFormData({...formData, exitTime: e.target.value})}
                            className="w-full bg-[#0a0a0a] border border-[#2d2e33] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#00FF00] transition-colors"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] text-[#8E9299] uppercase tracking-widest">Lý do</label>
                        <textarea
                          required
                          value={formData.reason}
                          onChange={(e) => setFormData({...formData, reason: e.target.value})}
                          className="w-full bg-[#0a0a0a] border border-[#2d2e33] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#00FF00] transition-colors min-h-[80px] resize-none"
                          placeholder="Đi công tác, việc cá nhân..."
                        />
                      </div>
                    </div>

                    <button
                      disabled={!capturedImage || !verificationResult?.success || isSubmitting}
                      className="w-full bg-[#00FF00] disabled:bg-[#1c1d21] disabled:text-[#8E9299] text-black font-bold py-3 rounded-lg transition-all flex items-center justify-center gap-2"
                    >
                      {isSubmitting ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-5 h-5" />
                      )}
                      GỬI PHIẾU XÁC MINH
                    </button>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}
