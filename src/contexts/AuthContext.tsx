'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { 
  GoogleAuthProvider, 
  signInWithCredential, 
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { db, auth } from '@/lib/firebase';
import { User } from '@/types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  signInWithGoogle: () => void;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Buffer time before expiration to refresh (5 minutes)
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number | null>(null);
  const refreshingRef = useRef<Promise<string | null> | null>(null);

  // Check for auth cookie on mount (after OAuth redirect) AND listen to Firebase Auth state
  useEffect(() => {
    let authCookieProcessed = false;
    
    const processAuthCookie = async () => {
      // Check for auth cookie from OAuth callback
      const cookies = document.cookie.split(';').map(c => c.trim());
      const authCookie = cookies.find(c => c.startsWith('flomail_auth='));
      
      if (authCookie) {
        try {
          const authData = JSON.parse(decodeURIComponent(authCookie.split('=')[1]));
          console.log('[Auth] Found auth cookie, processing...');
          
          // Clear the cookie immediately
          document.cookie = 'flomail_auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
          
          // Sign into Firebase Auth using the Google access token
          // This gives us Firebase Auth for Firestore security rules
          const credential = GoogleAuthProvider.credential(authData.idToken, authData.accessToken);
          const firebaseUserCredential = await signInWithCredential(auth, credential);
          const firebaseUser = firebaseUserCredential.user;
          
          console.log('[Auth] Signed into Firebase Auth:', firebaseUser.uid);
          
          // Store tokens in state
          setAccessToken(authData.accessToken);
          setRefreshToken(authData.refreshToken);
          setTokenExpiresAt(authData.expiresAt);
          
          // Create user object using Firebase UID
          const newUser: User = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || authData.user.email,
            displayName: firebaseUser.displayName || authData.user.name,
            photoURL: firebaseUser.photoURL || authData.user.picture,
            accessToken: authData.accessToken,
            refreshToken: authData.refreshToken,
          };
          
          setUser(newUser);
          
          // Store Google OAuth tokens in Firestore (keyed by Firebase UID)
          await setDoc(doc(db, 'users', firebaseUser.uid), {
            email: newUser.email,
            displayName: newUser.displayName,
            photoURL: newUser.photoURL,
            accessToken: authData.accessToken,
            refreshToken: authData.refreshToken,
            tokenExpiresAt: authData.expiresAt,
            updatedAt: new Date().toISOString(),
          }, { merge: true });
          
          console.log('[Auth] OAuth sign-in complete');
          authCookieProcessed = true;
          setLoading(false);
          return true;
        } catch (e) {
          console.error('[Auth] Error processing auth cookie:', e);
          document.cookie = 'flomail_auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        }
      }
      return false;
    };
    
    // Process auth cookie first
    processAuthCookie().then((processed) => {
      if (processed) return;
      
      // If no cookie, set up Firebase Auth state listener
      const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        if (authCookieProcessed) return; // Skip if we just processed a cookie
        
        if (firebaseUser) {
          console.log('[Auth] Firebase Auth state: signed in as', firebaseUser.email);
          
          // Get stored tokens from Firestore
          try {
            const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
            const userData = userDoc.data();
            
            if (userData?.accessToken) {
              setUser({
                uid: firebaseUser.uid,
                email: firebaseUser.email || userData.email || '',
                displayName: firebaseUser.displayName || userData.displayName,
                photoURL: firebaseUser.photoURL || userData.photoURL,
                accessToken: userData.accessToken,
                refreshToken: userData.refreshToken,
              });
              setAccessToken(userData.accessToken);
              setRefreshToken(userData.refreshToken);
              setTokenExpiresAt(userData.tokenExpiresAt);
              console.log('[Auth] Restored session from Firestore');
            } else {
              // Firebase user exists but no tokens - need to re-authenticate
              console.log('[Auth] No tokens found, user needs to re-authenticate');
              setUser(null);
            }
          } catch (e) {
            console.error('[Auth] Error restoring session:', e);
          }
        } else {
          console.log('[Auth] Firebase Auth state: signed out');
          setUser(null);
          setAccessToken(null);
          setRefreshToken(null);
          setTokenExpiresAt(null);
        }
        
        setLoading(false);
      });
      
      return () => unsubscribe();
    });
  }, []);

  // Redirect to Google OAuth
  const signInWithGoogle = useCallback(() => {
    setError(null);
    // Redirect to our OAuth endpoint
    window.location.href = '/api/auth/google';
  }, []);

  const signOut = useCallback(async () => {
    try {
      // Sign out of Firebase Auth
      await firebaseSignOut(auth);
      setUser(null);
      setAccessToken(null);
      setRefreshToken(null);
      setTokenExpiresAt(null);
      console.log('[Auth] Signed out');
    } catch (err: any) {
      console.error('Sign out error:', err);
      setError(err.message || 'Failed to sign out');
    }
  }, []);

  // Refresh the access token using the REAL Google refresh token
  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    if (!refreshToken) {
      console.warn('[Auth] No refresh token available');
      return null;
    }

    console.log('[Auth] Refreshing access token...');

    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('[Auth] Token refresh failed:', errorData);
        if (response.status === 401) {
          // Refresh token is invalid, user needs to re-authenticate
          setError('Session expired. Please sign in again.');
          await signOut();
        }
        return null;
      }

      const data = await response.json();
      const newToken = data.accessToken;
      const expiresIn = data.expiresIn || 3600;
      const newExpiresAt = Date.now() + expiresIn * 1000;

      // Update state
      setAccessToken(newToken);
      setTokenExpiresAt(newExpiresAt);

      // Update Firestore
      if (user?.uid) {
        await setDoc(doc(db, 'users', user.uid), {
          accessToken: newToken,
          tokenExpiresAt: newExpiresAt,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }

      console.log('[Auth] Token refreshed successfully, expires in', expiresIn, 'seconds');
      return newToken;
    } catch (error) {
      console.error('[Auth] Error refreshing token:', error);
      return null;
    }
  }, [refreshToken, user?.uid, signOut]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    // Check if we have a token and it's not expired (with buffer)
    const now = Date.now();
    const isExpired = tokenExpiresAt ? now > (tokenExpiresAt - REFRESH_BUFFER_MS) : true;
    
    if (accessToken && !isExpired) {
      return accessToken;
    }

    // Token is expired or missing - need to refresh
    if (refreshToken) {
      // Prevent multiple simultaneous refresh calls
      if (refreshingRef.current) {
        return refreshingRef.current;
      }
      
      refreshingRef.current = refreshAccessToken();
      try {
        const newToken = await refreshingRef.current;
        return newToken;
      } finally {
        refreshingRef.current = null;
      }
    }
    
    // Try to get from Firestore as fallback
    if (user?.uid) {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const userData = userDoc.data();
      const token = userData?.accessToken;
      const storedRefreshToken = userData?.refreshToken;
      const expiresAt = userData?.tokenExpiresAt;
      
      if (storedRefreshToken && !refreshToken) {
        setRefreshToken(storedRefreshToken);
      }
      
      if (token && expiresAt && Date.now() < (expiresAt - REFRESH_BUFFER_MS)) {
        setAccessToken(token);
        setTokenExpiresAt(expiresAt);
        return token;
      }
      
      // Token expired, try refresh with stored refresh token
      if (storedRefreshToken) {
        setRefreshToken(storedRefreshToken);
        return refreshAccessToken();
      }
    }
    
    return null;
  }, [accessToken, tokenExpiresAt, refreshToken, user?.uid, refreshAccessToken]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        signInWithGoogle,
        signOut,
        getAccessToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
