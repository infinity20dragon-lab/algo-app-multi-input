"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase/config";
import { ensureUserProfile, type UserProfile } from "@/lib/firebase/users";

// Extended user with role
export interface AuthUser extends User {
  role?: "user" | "admin";
  displayName: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        console.log("[Auth] User authenticated, setting user immediately");

        // Set user immediately with defaults (fast!)
        const extendedUser: AuthUser = {
          ...firebaseUser,
          role: "user", // Default role
          displayName: firebaseUser.email?.split("@")[0] || "User",
        };

        setUser(extendedUser);
        setLoading(false);

        // Try to load profile in background (won't block UI)
        try {
          console.log("[Auth] Loading user profile in background...");
          const profile = await ensureUserProfile(firebaseUser.uid, firebaseUser.email || "");

          console.log("[Auth] Profile loaded, updating user");
          // Update with profile data
          setUser({
            ...firebaseUser,
            role: profile.role,
            displayName: profile.displayName,
          });
        } catch (error) {
          console.error("[Auth] Background profile load failed (using defaults):", error);
          // Keep the default user we already set
        }
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
