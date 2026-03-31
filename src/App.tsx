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
  doc,
  setDoc,
  getDoc,
  updateDoc
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut, 
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification
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
  AlertCircle,
  Mail,
  Lock,
  GraduationCap,
  LayoutDashboard,
  Check,
  X
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

interface UserProfile {
  uid: string;
  email: string;
  role: 'admin' | 'student';
  displayName: string;
  className?: string;
  phoneNumber?: string;
  isVerified?: boolean;
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

// --- Error Boundary ---
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "An unexpected error occurred.";
      try {
        const parsedError = JSON.parse(this.state.error.message);
        if (parsedError.error) {
          errorMessage = `Firestore Error: ${parsedError.error} (${parsedError.operationType} on ${parsedError.path})`;
        }
      } catch (e) {
        errorMessage = this.state.error.message || errorMessage;
      }

      return (
        <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#141414] border border-red-500/20 rounded-2xl p-8 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
            <p className="text-gray-400 mb-6 text-sm">{errorMessage}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// --- App Component ---
export default function App() {
  return (
    <ErrorBoundary>
      <GatePassApp />
    </ErrorBoundary>
  );
}

function GatePassApp() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [passes, setPasses] = useState<GatePass[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [loginMode, setLoginMode] = useState<'student' | 'admin'>('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
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
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerData, setRegisterData] = useState({
    fullName: '',
    className: '',
    phoneNumber: '',
    email: '',
    password: ''
  });
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState(false);

  const webcamRef = useRef<Webcam>(null);

  // Pre-fill form data from user profile
  useEffect(() => {
    if (userProfile && userProfile.role === 'student') {
      setFormData(prev => ({
        ...prev,
        fullName: userProfile.displayName || '',
        department: userProfile.className || ''
      }));
    }
  }, [userProfile]);

  // --- Auth & Initial Load ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        // Fetch or create user profile
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
          setUserProfile(userDoc.data() as UserProfile);
        } else {
          // If profile doesn't exist (e.g. Google login for first time)
          const newProfile: UserProfile = {
            uid: currentUser.uid,
            email: currentUser.email || '',
            role: 'student',
            displayName: currentUser.displayName || 'Học sinh',
            isVerified: false
          };
          try {
            await setDoc(userDocRef, newProfile);
            setUserProfile(newProfile);
          } catch (err) {
            console.error("Failed to create profile:", err);
          }
        }
      } else {
        setUserProfile(null);
        setFormData({
          fullName: '',
          department: '',
          reason: '',
          exitTime: new Date().toISOString().slice(0, 16)
        });
      }
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Check for camera permissions
  useEffect(() => {
    if (isCreating) {
      navigator.mediaDevices.getUserMedia({ video: true })
        .then(() => setCameraError(null))
        .catch((err) => {
          console.error("Camera access denied:", err);
          setCameraError("Vui lòng cấp quyền truy cập Camera để tiếp tục.");
        });
    }
  }, [isCreating]);

  useEffect(() => {
    if (!user || !userProfile) return;

    let q;
    if (userProfile.role === 'admin') {
      // Admin sees all
      q = query(
        collection(db, 'gatepasses'),
        orderBy('createdAt', 'desc')
      );
    } else {
      // Student sees only their own
      q = query(
        collection(db, 'gatepasses'),
        where('uid', '==', user.uid),
        orderBy('createdAt', 'desc')
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GatePass));
      setPasses(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'gatepasses');
    });

    return () => unsubscribe();
  }, [user, userProfile]);

  // --- Handlers ---
  const handleGoogleLogin = async () => {
    setLoginError(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Login failed", error);
      setLoginError(error.message || "Đăng nhập Google thất bại.");
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error: any) {
      console.error("Email login failed", error);
      setLoginError("Tài khoản hoặc mật khẩu không chính xác.");
    }
  };

  const handleLogout = () => signOut(auth);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setRegisterLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, registerData.email, registerData.password);
      const newUser = userCredential.user;

      // Create profile
      const newProfile: UserProfile = {
        uid: newUser.uid,
        email: registerData.email,
        role: 'student',
        displayName: registerData.fullName,
        className: registerData.className,
        phoneNumber: registerData.phoneNumber,
        isVerified: false
      };

      await setDoc(doc(db, 'users', newUser.uid), newProfile);
      setUserProfile(newProfile);
      
      // Send verification email
      await sendEmailVerification(newUser);
      setRegisterSuccess(true);
      
      setTimeout(() => {
        setIsRegistering(false);
        setRegisterSuccess(false);
      }, 3000);

    } catch (error: any) {
      console.error("Registration failed", error);
      if (error.code === 'auth/email-already-in-use') {
        setLoginError("Email này đã được sử dụng.");
      } else if (error.code === 'auth/weak-password') {
        setLoginError("Mật khẩu quá yếu (tối thiểu 6 ký tự).");
      } else {
        setLoginError("Đăng ký thất bại. Vui lòng thử lại.");
      }
    } finally {
      setRegisterLoading(false);
    }
  };

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
      const base64Data = imageSrc.split(',')[1];
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{
          parts: [
            { text: "Analyze this image. Is there a clear human face present? Respond in JSON format with 'success' (boolean) and 'message' (string in Vietnamese)." },
            { inlineData: { mimeType: "image/jpeg", data: base64Data } }
          ]
        }],
        config: { responseMimeType: "application/json" }
      });
      const result = JSON.parse(response.text || '{"success": false, "message": "Lỗi AI."}');
      setVerificationResult(result);
    } catch (error) {
      setVerificationResult({ success: false, message: "Lỗi kết nối AI." });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSubmitPass = async (e: React.FormEvent) => {
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
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'gatepasses');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async (passId: string, status: 'approved' | 'rejected') => {
    if (userProfile?.role !== 'admin') return;
    try {
      await updateDoc(doc(db, 'gatepasses', passId), { status });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `gatepasses/${passId}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#00FF00] animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center p-6 text-white font-mono">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-[#151619] border border-[#1c1d21] rounded-2xl p-8 shadow-2xl"
        >
          <div className="flex justify-center mb-8">
            <div className="bg-[#00FF00]/10 p-4 rounded-full border border-[#00FF00]/20">
              <ShieldCheck className="w-10 h-10 text-[#00FF00]" />
            </div>
          </div>
          
          <h1 className="text-2xl font-bold text-center mb-2 tracking-tighter">GATEPASS AI</h1>
          <p className="text-[#8E9299] text-center text-xs mb-8 uppercase tracking-widest">Hệ thống quản lý ra cổng</p>

          <div className="flex bg-[#0a0a0a] p-1 rounded-xl mb-6 border border-[#1c1d21]">
            <button 
              onClick={() => setLoginMode('student')}
              className={cn(
                "flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2",
                loginMode === 'student' ? "bg-[#1c1d21] text-[#00FF00]" : "text-[#8E9299]"
              )}
            >
              <GraduationCap className="w-4 h-4" /> HỌC SINH
            </button>
            <button 
              onClick={() => setLoginMode('admin')}
              className={cn(
                "flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2",
                loginMode === 'admin' ? "bg-[#1c1d21] text-[#00FF00]" : "text-[#8E9299]"
              )}
            >
              <ShieldCheck className="w-4 h-4" /> QUẢN TRỊ
            </button>
          </div>

          {loginError && (
            <div className="mb-6 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-500 text-[10px] flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {loginError}
            </div>
          )}

          {registerSuccess && (
            <div className="mb-6 p-3 bg-[#00FF00]/10 border border-[#00FF00]/50 rounded-lg text-[#00FF00] text-[10px] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Đăng ký thành công! Vui lòng kiểm tra email để xác minh tài khoản.
            </div>
          )}

          {isRegistering ? (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-3">
                <input 
                  required type="text" placeholder="Họ và tên" 
                  className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl px-4 py-3 text-sm focus:border-[#00FF00] outline-none"
                  value={registerData.fullName} onChange={(e) => setRegisterData({...registerData, fullName: e.target.value})}
                />
                <input 
                  required type="text" placeholder="Lớp (Ví dụ: 12A1)" 
                  className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl px-4 py-3 text-sm focus:border-[#00FF00] outline-none"
                  value={registerData.className} onChange={(e) => setRegisterData({...registerData, className: e.target.value})}
                />
                <input 
                  required type="tel" placeholder="Số điện thoại" 
                  className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl px-4 py-3 text-sm focus:border-[#00FF00] outline-none"
                  value={registerData.phoneNumber} onChange={(e) => setRegisterData({...registerData, phoneNumber: e.target.value})}
                />
                <input 
                  required type="email" placeholder="Email" 
                  className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl px-4 py-3 text-sm focus:border-[#00FF00] outline-none"
                  value={registerData.email} onChange={(e) => setRegisterData({...registerData, email: e.target.value})}
                />
                <input 
                  required type="password" placeholder="Mật khẩu (tối thiểu 6 ký tự)" 
                  className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl px-4 py-3 text-sm focus:border-[#00FF00] outline-none"
                  value={registerData.password} onChange={(e) => setRegisterData({...registerData, password: e.target.value})}
                />
              </div>
              <button disabled={registerLoading} className="w-full bg-[#00FF00] text-black font-bold py-3 rounded-xl hover:bg-[#00CC00] transition-all active:scale-95 flex items-center justify-center gap-2">
                {registerLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "ĐĂNG KÝ HỌC SINH"}
              </button>
              <button type="button" onClick={() => setIsRegistering(false)} className="w-full text-[10px] text-[#8E9299] hover:text-white transition-colors uppercase tracking-widest">
                Đã có tài khoản? Đăng nhập
              </button>
            </form>
          ) : loginMode === 'student' ? (
            <div className="space-y-4">
              <button 
                onClick={handleGoogleLogin}
                className="w-full bg-white text-black font-bold py-3 rounded-xl hover:bg-[#E6E6E6] transition-all flex items-center justify-center gap-2 active:scale-95"
              >
                <img src="https://www.google.com/favicon.ico" className="w-4 h-4" alt="Google" />
                Đăng nhập Google
              </button>
              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#1c1d21]"></div></div>
                <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-[#151619] px-2 text-[#8E9299]">Hoặc dùng Email</span></div>
              </div>
              <form onSubmit={handleEmailLogin} className="space-y-3">
                <div className="relative">
                  <Mail className="absolute left-3 top-3 w-4 h-4 text-[#8E9299]" />
                  <input 
                    type="email" placeholder="Email học sinh" 
                    className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl pl-10 pr-4 py-3 text-sm focus:border-[#00FF00] outline-none"
                    value={email} onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 w-4 h-4 text-[#8E9299]" />
                  <input 
                    type="password" placeholder="Mật khẩu" 
                    className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl pl-10 pr-4 py-3 text-sm focus:border-[#00FF00] outline-none"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <button className="w-full bg-[#1c1d21] text-white font-bold py-3 rounded-xl hover:bg-[#2d2e33] transition-all active:scale-95">
                  ĐĂNG NHẬP
                </button>
              </form>
              <button onClick={() => setIsRegistering(true)} className="w-full text-[10px] text-[#8E9299] hover:text-white transition-colors uppercase tracking-widest">
                Chưa có tài khoản? Đăng ký ngay
              </button>
            </div>
          ) : (
            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div className="relative">
                <ShieldCheck className="absolute left-3 top-3 w-4 h-4 text-[#8E9299]" />
                <input 
                  type="email" placeholder="Email quản trị" 
                  className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl pl-10 pr-4 py-3 text-sm focus:border-[#00FF00] outline-none"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-3 w-4 h-4 text-[#8E9299]" />
                <input 
                  type="password" placeholder="Mật khẩu hệ thống" 
                  className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl pl-10 pr-4 py-3 text-sm focus:border-[#00FF00] outline-none"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <button className="w-full bg-[#00FF00] text-black font-bold py-3 rounded-xl hover:bg-[#00CC00] transition-all active:scale-95">
                ĐĂNG NHẬP QUẢN TRỊ
              </button>
              <p className="text-[10px] text-center text-[#8E9299] italic">Tài khoản quản trị do hệ thống cung cấp</p>
            </form>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-mono">
      {/* Header */}
      <header className="border-b border-[#1c1d21] bg-[#0a0a0a]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#00FF00] rounded flex items-center justify-center"><ShieldCheck className="w-5 h-5 text-black" /></div>
            <span className="font-bold tracking-widest text-sm">GATEPASS.SYS</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="text-[9px] text-[#00FF00] font-bold uppercase tracking-widest">{userProfile?.role}</span>
              <span className="text-xs font-bold">{user.displayName || user.email}</span>
            </div>
            <button onClick={handleLogout} className="p-2 hover:bg-[#1c1d21] rounded-lg transition-colors text-[#8E9299] hover:text-white"><LogOut className="w-5 h-5" /></button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Main Content */}
          <div className="lg:col-span-8 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <LayoutDashboard className="w-5 h-5 text-[#00FF00]" />
                {userProfile?.role === 'admin' ? "DANH SÁCH DUYỆT PHIẾU" : "LỊCH SỬ CỦA TÔI"}
              </h2>
              {userProfile?.role === 'student' && (
                <button 
                  onClick={() => setIsCreating(!isCreating)}
                  className={cn("flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-bold transition-all shadow-lg active:scale-95", isCreating ? "bg-[#1c1d21]" : "bg-[#00FF00] text-black")}
                >
                  {isCreating ? <XCircle className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  {isCreating ? "ĐÓNG" : "TẠO PHIẾU"}
                </button>
              )}
            </div>

            {user && !user.emailVerified && userProfile?.role === 'student' && (
              <div className="p-4 bg-yellow-500/10 border border-yellow-500/50 rounded-2xl text-yellow-500 text-xs flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <p>Tài khoản chưa xác minh. Vui lòng kiểm tra email để kích hoạt đầy đủ tính năng.</p>
                </div>
                <button 
                  onClick={() => sendEmailVerification(user).then(() => alert("Đã gửi lại email xác minh!"))}
                  className="px-4 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 rounded-lg font-bold transition-colors whitespace-nowrap"
                >
                  GỬI LẠI
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4">
              <AnimatePresence mode="popLayout">
                {passes.map((pass) => (
                  <motion.div
                    key={pass.id}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-[#151619] border border-[#1c1d21] rounded-2xl p-5 flex flex-col sm:flex-row gap-5 hover:border-[#2d2e33] transition-all"
                  >
                    <div className="w-24 h-24 rounded-xl overflow-hidden bg-[#0a0a0a] flex-shrink-0 border border-[#1c1d21]">
                      <img src={pass.photoUrl} alt="Face" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-grow space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-base">{pass.fullName}</h3>
                        <span className={cn(
                          "text-[10px] px-3 py-1 rounded-full uppercase font-bold",
                          pass.status === 'approved' ? "bg-[#00FF00]/10 text-[#00FF00]" :
                          pass.status === 'rejected' ? "bg-red-500/10 text-red-500" : "bg-yellow-500/10 text-yellow-500"
                        )}>
                          {pass.status}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-[#8E9299] uppercase tracking-wider">
                        <span>Bộ phận: <span className="text-white">{pass.department}</span></span>
                        <span>Thời gian: <span className="text-white">{new Date(pass.exitTime).toLocaleString('vi-VN')}</span></span>
                        <span className="col-span-2 mt-1">Lý do: <span className="text-white normal-case">{pass.reason}</span></span>
                      </div>
                      
                      {userProfile?.role === 'admin' && pass.status === 'pending' && (
                        <div className="flex gap-2 pt-3">
                          <button 
                            onClick={() => handleUpdateStatus(pass.id!, 'approved')}
                            className="flex-1 bg-[#00FF00]/10 text-[#00FF00] hover:bg-[#00FF00] hover:text-black py-2 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1"
                          >
                            <Check className="w-3 h-3" /> DUYỆT
                          </button>
                          <button 
                            onClick={() => handleUpdateStatus(pass.id!, 'rejected')}
                            className="flex-1 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white py-2 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-1"
                          >
                            <X className="w-3 h-3" /> TỪ CHỐI
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* Sidebar: Form */}
          <div className="lg:col-span-4">
            <AnimatePresence>
              {isCreating && userProfile?.role === 'student' && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="bg-[#151619] border border-[#1c1d21] rounded-2xl overflow-hidden shadow-2xl sticky top-24"
                >
                  <div className="p-4 border-b border-[#1c1d21] bg-[#1c1d21]/50 flex items-center justify-between">
                    <h2 className="text-xs font-bold tracking-widest uppercase">ĐĂNG KÝ RA CỔNG</h2>
                    <button onClick={() => setIsCreating(false)}><X className="w-4 h-4 text-[#8E9299]" /></button>
                  </div>

                  <form onSubmit={handleSubmitPass} className="p-6 space-y-6">
                    <div className="space-y-2">
                      <label className="text-[9px] text-[#8E9299] uppercase tracking-widest block">Xác minh khuôn mặt</label>
                      <div className="relative aspect-square bg-black rounded-xl overflow-hidden border border-[#1c1d21]">
                        {cameraError ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-[#0a0a0a]">
                            <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
                            <p className="text-[10px] text-red-500">{cameraError}</p>
                          </div>
                        ) : !capturedImage ? (
                          <>
                            <Webcam audio={false} ref={webcamRef} screenshotFormat="image/jpeg" className="w-full h-full object-cover" videoConstraints={{ facingMode: "user" }} />
                            <button type="button" onClick={capture} className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-[#00FF00] text-black p-4 rounded-full shadow-xl active:scale-90 transition-all"><Camera className="w-6 h-6" /></button>
                          </>
                        ) : (
                          <div className="relative w-full h-full">
                            <img src={capturedImage} className="w-full h-full object-cover" alt="Captured" />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                              {isVerifying ? <Loader2 className="w-8 h-8 text-[#00FF00] animate-spin" /> : (
                                <div className={cn("p-3 rounded-xl text-center max-w-[80%]", verificationResult?.success ? "bg-[#00FF00]/20 text-[#00FF00]" : "bg-red-500/20 text-red-500")}>
                                  <p className="text-[10px] font-bold">{verificationResult?.message}</p>
                                  <button type="button" onClick={() => setCapturedImage(null)} className="mt-2 text-[9px] underline uppercase">Chụp lại</button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <input required type="text" placeholder="Họ và tên" value={formData.fullName} onChange={(e) => setFormData({...formData, fullName: e.target.value})} className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl px-4 py-3 text-sm focus:border-[#00FF00] outline-none" />
                      <input required type="text" placeholder="Bộ phận/Lớp" value={formData.department} onChange={(e) => setFormData({...formData, department: e.target.value})} className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl px-4 py-3 text-sm focus:border-[#00FF00] outline-none" />
                      <input required type="datetime-local" value={formData.exitTime} onChange={(e) => setFormData({...formData, exitTime: e.target.value})} className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl px-4 py-3 text-sm focus:border-[#00FF00] outline-none" />
                      <textarea required placeholder="Lý do ra cổng" value={formData.reason} onChange={(e) => setFormData({...formData, reason: e.target.value})} className="w-full bg-[#0a0a0a] border border-[#1c1d21] rounded-xl px-4 py-3 text-sm focus:border-[#00FF00] outline-none min-h-[80px] resize-none" />
                    </div>

                    <button disabled={!capturedImage || !verificationResult?.success || isSubmitting} className="w-full bg-[#00FF00] disabled:bg-[#1c1d21] disabled:text-[#8E9299] text-black font-bold py-4 rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2">
                      {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                      GỬI PHIẾU
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
