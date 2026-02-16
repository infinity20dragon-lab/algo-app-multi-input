import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "./config";

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: "user" | "admin";
  createdAt: Date;
  lastLogin: Date;
}

/**
 * Get user profile from Firestore with retry logic
 */
export async function getUserProfile(uid: string, retries = 3): Promise<UserProfile | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[Firebase] Attempt ${attempt}/${retries} to get user profile for:`, uid);
      const docRef = doc(db, "users", uid);
      const snapshot = await getDoc(docRef);

      if (!snapshot.exists()) {
        console.log('[Firebase] User profile not found');
        return null;
      }

      const data = snapshot.data();
      console.log('[Firebase] User profile loaded successfully');
      return {
        uid: snapshot.id,
        email: data.email,
        displayName: data.displayName || data.email?.split("@")[0] || "User",
        role: data.role || "user",
        createdAt: data.createdAt?.toDate() || new Date(),
        lastLogin: data.lastLogin?.toDate() || new Date(),
      };
    } catch (error: any) {
      console.error(`[Firebase] Attempt ${attempt} failed:`, error.code, error.message);

      if (attempt === retries) {
        console.error('[Firebase] All retry attempts exhausted');
        return null;
      }

      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }

  return null;
}

/**
 * Create or update user profile on login with retry logic
 */
export async function ensureUserProfile(
  uid: string,
  email: string,
  retries = 3
): Promise<UserProfile> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[Firebase] Attempt ${attempt}/${retries} to ensure user profile for:`, uid);
      console.log('[Firebase] Firestore instance check:', {
        type: db.type,
        projectId: db.app.options.projectId,
      });

      const docRef = doc(db, "users", uid);
      console.log('[Firebase] Document reference created:', {
        path: docRef.path,
        id: docRef.id,
      });

      console.log('[Firebase] Starting getDoc call...');
      const snapshot = await getDoc(docRef);
      console.log('[Firebase] getDoc call completed successfully');

      if (snapshot.exists()) {
        console.log('[Firebase] User profile found, updating last login');
        // Update last login
        await updateDoc(docRef, {
          lastLogin: new Date(),
        });

        const data = snapshot.data();
        return {
          uid,
          email: data.email,
          displayName: data.displayName || email.split("@")[0],
          role: data.role || "user",
          createdAt: data.createdAt?.toDate() || new Date(),
          lastLogin: new Date(),
        };
      } else {
        console.log('[Firebase] Creating new user profile');
        // Create new user profile
        const newProfile: UserProfile = {
          uid,
          email,
          displayName: email.split("@")[0],
          role: "user", // Default role
          createdAt: new Date(),
          lastLogin: new Date(),
        };

        await setDoc(docRef, {
          ...newProfile,
          createdAt: new Date(),
          lastLogin: new Date(),
        });

        console.log('[Firebase] User profile created successfully');
        return newProfile;
      }
    } catch (error: any) {
      console.error(`[Firebase] Attempt ${attempt} failed with detailed error:`, {
        code: error.code,
        message: error.message,
        name: error.name,
        stack: error.stack?.split('\n').slice(0, 3).join('\n'),
        errorType: typeof error,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      });

      // Check if we're online
      if (typeof navigator !== 'undefined') {
        console.log('[Firebase] Network status:', {
          online: navigator.onLine,
        });
      }

      if (attempt === retries) {
        console.error('[Firebase] All retry attempts exhausted, throwing error');
        throw error;
      }

      // Wait before retry (exponential backoff)
      console.log(`[Firebase] Waiting ${1000 * attempt}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }

  // This should never be reached, but TypeScript needs it
  throw new Error('Unexpected: ensureUserProfile exhausted retries without returning');
}

/**
 * Update user role (admin only operation)
 */
export async function updateUserRole(
  uid: string,
  role: "user" | "admin"
): Promise<void> {
  const docRef = doc(db, "users", uid);
  await updateDoc(docRef, { role });
}
