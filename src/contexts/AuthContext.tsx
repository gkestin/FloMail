'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  User as FirebaseUser,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  getAdditionalUserInfo,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, googleProvider, db } from '@/lib/firebase';
import { User } from '@/types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
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
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number | null>(null);
  const refreshingRef = useRef<Promise<string | null> | null>(null);

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Get stored user data from Firestore
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        const userData = userDoc.data();
        
        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email || '',
          displayName: firebaseUser.displayName || undefined,
          photoURL: firebaseUser.photoURL || undefined,
          accessToken: userData?.accessToken,
          refreshToken: userData?.refreshToken,
        });
        
        if (userData?.accessToken) {
          setAccessToken(userData.accessToken);
          setTokenExpiresAt(userData.tokenExpiresAt || null);
        }
      } else {
        setUser(null);
        setAccessToken(null);
        setTokenExpiresAt(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);

      const result = await signInWithPopup(auth, googleProvider);
      const credential = await result.user.getIdTokenResult();
      
      // Get OAuth access token from the credential
      // @ts-expect-error - Firebase types don't expose this properly
      const oauthCredential = result._tokenResponse;
      const token = oauthCredential?.oauthAccessToken;
      const refreshToken = oauthCredential?.refreshToken;

      if (token) {
        setAccessToken(token);
        // Access tokens expire in 1 hour (3600 seconds)
        const expiresAt = Date.now() + 3600 * 1000;
        setTokenExpiresAt(expiresAt);
        
        // Store tokens in Firestore
        await setDoc(doc(db, 'users', result.user.uid), {
          email: result.user.email,
          displayName: result.user.displayName,
          photoURL: result.user.photoURL,
          accessToken: token,
          refreshToken: refreshToken,
          tokenExpiresAt: expiresAt,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }

      setUser({
        uid: result.user.uid,
        email: result.user.email || '',
        displayName: result.user.displayName || undefined,
        photoURL: result.user.photoURL || undefined,
        accessToken: token,
        refreshToken: refreshToken,
      });
    } catch (err: any) {
      console.error('Sign in error:', err);
      setError(err.message || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await firebaseSignOut(auth);
      setUser(null);
      setAccessToken(null);
    } catch (err: any) {
      console.error('Sign out error:', err);
      setError(err.message || 'Failed to sign out');
    }
  }, []);

  // Refresh the access token using the refresh token
  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    if (!user?.refreshToken) {
      console.warn('No refresh token available');
      return null;
    }

    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: user.refreshToken }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Token refresh failed:', error);
        // If token is invalid, sign out the user
        if (response.status === 401) {
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
      if (user.uid) {
        await setDoc(doc(db, 'users', user.uid), {
          accessToken: newToken,
          tokenExpiresAt: newExpiresAt,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      }

      console.log('Token refreshed successfully');
      return newToken;
    } catch (error) {
      console.error('Error refreshing token:', error);
      return null;
    }
  }, [user?.refreshToken, user?.uid, signOut]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    // Check if we have a token and it's not expired (with buffer)
    const isExpired = tokenExpiresAt ? Date.now() > (tokenExpiresAt - REFRESH_BUFFER_MS) : false;
    
    if (accessToken && !isExpired) {
      return accessToken;
    }

    // Token is expired or missing - need to refresh
    if (user?.refreshToken) {
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
      const expiresAt = userData?.tokenExpiresAt;
      
      if (token && expiresAt && Date.now() < (expiresAt - REFRESH_BUFFER_MS)) {
        setAccessToken(token);
        setTokenExpiresAt(expiresAt);
        return token;
      }
    }
    
    return null;
  }, [accessToken, tokenExpiresAt, user?.refreshToken, user?.uid, refreshAccessToken]);

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


