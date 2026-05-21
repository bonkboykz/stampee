import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { TIER_LIMITS, User } from "../types";
import { api, ApiError, isApiConfigured, tokenStore } from "../lib/api";
import { profileToUser, fetchProfile, fetchStaffAccounts } from "../lib/db/profiles";
import { normalizeSlug } from "../lib/slug";
import { DEMO_WORKSPACE_ENABLED } from "../lib/siteConfig";

export type AuthResult = { ok: true; user?: User; message?: string } | { ok: false; error: string };

interface AuthContextValue {
  currentUser: User | null;
  currentOwner: User | null;
  isOwner: boolean;
  isStaff: boolean;
  isEmailVerified: boolean;
  loading: boolean;
  staffAccounts: User[];
  login: (email: string, password: string) => Promise<AuthResult>;
  loginStaff: (email: string, pin: string, orgId: string) => Promise<AuthResult>;
  signup: (payload: { businessName: string; email: string; password: string; slug: string }) => Promise<AuthResult>;
  loginDemo: () => Promise<void>;
  createStaff: (payload: { name: string; email: string; pin: string }) => Promise<AuthResult>;
  updateStaffPin: (staffId: string, pin: string) => Promise<AuthResult>;
  setStaffAccess: (staffId: string, access: "active" | "disabled") => Promise<AuthResult>;
  deleteStaff: (staffId: string) => Promise<AuthResult>;
  deleteAccount: () => Promise<AuthResult>;
  logout: () => Promise<void>;
  resendVerificationEmail: () => Promise<AuthResult>;
  isSlugAvailable: (slug: string) => Promise<boolean>;
  updateProfileInfo: (payload: { businessName?: string; email?: string; slug?: string }) => Promise<AuthResult>;
  updatePassword: (newPassword: string) => Promise<AuthResult>;
  resetPassword: (email: string) => Promise<AuthResult>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const CONFIG_ERROR_MESSAGE = "Service is temporarily unavailable. Please try again later.";
const SIGNUP_ERROR_MESSAGE = "Unable to create your account right now. Please try again.";
const SIGNUP_EMAIL_EXISTS_MESSAGE = "An account with this email already exists. Please log in instead.";
const SIGNIN_ERROR_MESSAGE = "Unable to sign in right now. Please try again.";
const PROFILE_UPDATE_ERROR = "Unable to update your profile right now. Please try again.";
const PASSWORD_UPDATE_ERROR = "Unable to update your password right now. Please try again.";
const STAFF_ACTION_ERROR = "Unable to complete this staff action right now. Please try again.";
const ACCOUNT_ACTION_ERROR = "Unable to complete this account action right now. Please try again.";

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentOwner, setCurrentOwner] = useState<User | null>(null);
  const [staffAccounts, setStaffAccounts] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const loadOwnerContext = useCallback(async (profile: User) => {
    setCurrentUser(profile);
    if (profile.role === "owner") {
      setCurrentOwner(profile);
      setStaffAccounts(await fetchStaffAccounts(profile.id));
    } else if (profile.ownerId) {
      const owner = await fetchProfile(profile.ownerId);
      setCurrentOwner(owner);
      if (owner) setStaffAccounts(await fetchStaffAccounts(owner.id));
    }
  }, []);

  const clearSession = useCallback(() => {
    tokenStore.set(null);
    setCurrentUser(null);
    setCurrentOwner(null);
    setStaffAccounts([]);
  }, []);

  useEffect(() => {
    if (!isApiConfigured) {
      clearSession();
      setLoading(false);
      return;
    }
    let mounted = true;
    (async () => {
      if (!tokenStore.get()) {
        setLoading(false);
        return;
      }
      try {
        const { profile } = await api.get<{ profile: Record<string, unknown> }>("/auth/me");
        if (mounted) await loadOwnerContext(profileToUser(profile));
      } catch {
        if (mounted) clearSession();
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [clearSession, loadOwnerContext]);

  const refreshProfile = useCallback(async () => {
    if (!isApiConfigured || !currentUser) return;
    try {
      const { profile } = await api.get<{ profile: Record<string, unknown> }>("/auth/me");
      await loadOwnerContext(profileToUser(profile));
    } catch {
      clearSession();
    }
  }, [clearSession, currentUser, loadOwnerContext]);

  const login = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    if (!isApiConfigured) return { ok: false, error: CONFIG_ERROR_MESSAGE };
    try {
      const { token, profile } = await api.post<{ token: string; profile: Record<string, unknown> }>(
        "/auth/login",
        { email: email.trim().toLowerCase(), password }
      );
      tokenStore.set(token);
      const user = profileToUser(profile);
      await loadOwnerContext(user);
      return { ok: true, user };
    } catch (err) {
      if (err instanceof ApiError) return { ok: false, error: err.message };
      return { ok: false, error: SIGNIN_ERROR_MESSAGE };
    }
  }, [loadOwnerContext]);

  const loginStaff = useCallback(async (email: string, pin: string, orgId: string): Promise<AuthResult> => {
    if (!isApiConfigured) return { ok: false, error: CONFIG_ERROR_MESSAGE };
    try {
      const { token, profile } = await api.post<{ token: string; profile: Record<string, unknown> }>(
        "/auth/staff-login",
        { email: email.trim().toLowerCase(), pin, orgId }
      );
      tokenStore.set(token);
      const user = profileToUser(profile);
      await loadOwnerContext(user);
      return { ok: true, user };
    } catch (err) {
      if (err instanceof ApiError) return { ok: false, error: err.message };
      return { ok: false, error: SIGNIN_ERROR_MESSAGE };
    }
  }, [loadOwnerContext]);

  const signup = useCallback(async (payload: {
    businessName: string; email: string; password: string; slug: string;
  }): Promise<AuthResult> => {
    if (!isApiConfigured) return { ok: false, error: CONFIG_ERROR_MESSAGE };
    try {
      const { token, profile } = await api.post<{ token: string; profile: Record<string, unknown> }>(
        "/auth/signup",
        {
          businessName: payload.businessName.trim(),
          email: payload.email.trim().toLowerCase(),
          password: payload.password,
          slug: normalizeSlug(payload.slug),
        }
      );
      tokenStore.set(token);
      const user = profileToUser(profile);
      await loadOwnerContext(user);
      return { ok: true, user };
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409 && err.message.toLowerCase().includes("email")) {
          return { ok: false, error: SIGNUP_EMAIL_EXISTS_MESSAGE };
        }
        return { ok: false, error: err.message };
      }
      return { ok: false, error: SIGNUP_ERROR_MESSAGE };
    }
  }, [loadOwnerContext]);

  const loginDemo = useCallback(async () => {
    if (!DEMO_WORKSPACE_ENABLED) {
      throw new Error("Demo workspace is currently unavailable.");
    }
    if (!isApiConfigured) return;
    const demoEmail = "demo@stampee.co";
    const demoPassword = "demo1234";
    try {
      await api.post<{ token: string; profile: Record<string, unknown> }>("/auth/login", {
        email: demoEmail,
        password: demoPassword,
      });
    } catch {
      await api.post<{ token: string; profile: Record<string, unknown> }>("/auth/signup", {
        businessName: "Demo Donut Co.",
        email: demoEmail,
        password: demoPassword,
        slug: "demo-donut",
      }).catch(() => undefined);
    }
    // re-trigger login flow to set state
    await login(demoEmail, demoPassword);
  }, [login]);

  const createStaff = useCallback(async (payload: { name: string; email: string; pin: string }): Promise<AuthResult> => {
    if (!isApiConfigured) return { ok: false, error: CONFIG_ERROR_MESSAGE };
    if (!currentOwner || currentUser?.role !== "owner") return { ok: false, error: "Only owners can manage staff." };
    if (!/^\d{4,6}$/.test(payload.pin)) return { ok: false, error: "PIN should be 4-6 digits." };
    const staffLimit = TIER_LIMITS[currentOwner.tier].staff;
    if (staffAccounts.length >= staffLimit) {
      return {
        ok: false,
        error: `Free beta access allows only ${staffLimit} staff account${staffLimit === 1 ? "" : "s"}. Contact hello@stampee.co if you need higher limits.`,
      };
    }
    try {
      await api.post("/auth/staff", {
        name: payload.name.trim(),
        email: payload.email.trim().toLowerCase(),
        pin: payload.pin,
      });
      setStaffAccounts(await fetchStaffAccounts(currentOwner.id));
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError) return { ok: false, error: err.message };
      return { ok: false, error: STAFF_ACTION_ERROR };
    }
  }, [currentOwner, currentUser, staffAccounts.length]);

  const updateStaffPin = useCallback(async (staffId: string, pin: string): Promise<AuthResult> => {
    if (!isApiConfigured) return { ok: false, error: CONFIG_ERROR_MESSAGE };
    if (!currentOwner || currentUser?.role !== "owner") return { ok: false, error: "Only owners can manage staff." };
    if (!/^\d{4,6}$/.test(pin)) return { ok: false, error: "PIN should be 4-6 digits." };
    try {
      await api.patch(`/auth/staff/${staffId}/pin`, { pin });
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError) return { ok: false, error: err.message };
      return { ok: false, error: STAFF_ACTION_ERROR };
    }
  }, [currentOwner, currentUser]);

  const setStaffAccess = useCallback(async (staffId: string, access: "active" | "disabled"): Promise<AuthResult> => {
    if (!isApiConfigured) return { ok: false, error: CONFIG_ERROR_MESSAGE };
    if (!currentOwner || currentUser?.role !== "owner") return { ok: false, error: "Only owners can manage staff." };
    try {
      await api.patch(`/profiles/${staffId}`, { access });
      setStaffAccounts(await fetchStaffAccounts(currentOwner.id));
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError) return { ok: false, error: err.message };
      return { ok: false, error: STAFF_ACTION_ERROR };
    }
  }, [currentOwner, currentUser]);

  const deleteStaff = useCallback(async (staffId: string): Promise<AuthResult> => {
    if (!isApiConfigured) return { ok: false, error: CONFIG_ERROR_MESSAGE };
    if (!currentOwner || currentUser?.role !== "owner") return { ok: false, error: "Only owners can manage staff." };
    try {
      await api.delete(`/auth/staff/${staffId}`);
      setStaffAccounts(await fetchStaffAccounts(currentOwner.id));
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError) return { ok: false, error: err.message };
      return { ok: false, error: STAFF_ACTION_ERROR };
    }
  }, [currentOwner, currentUser]);

  const deleteAccount = useCallback(async (): Promise<AuthResult> => {
    if (!isApiConfigured) return { ok: false, error: CONFIG_ERROR_MESSAGE };
    if (!currentOwner || currentUser?.role !== "owner") return { ok: false, error: "Only owners can delete the account." };
    try {
      await api.delete("/auth/account");
      clearSession();
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError) return { ok: false, error: err.message };
      return { ok: false, error: ACCOUNT_ACTION_ERROR };
    }
  }, [clearSession, currentOwner, currentUser]);

  const logout = useCallback(async () => {
    if (!isApiConfigured) return;
    try { await api.post("/auth/logout"); } catch { /* ignore */ }
    clearSession();
  }, [clearSession]);

  const resendVerificationEmail = useCallback(async (): Promise<AuthResult> => {
    return { ok: true, message: "Email verification is currently disabled. Your account is already active." };
  }, []);

  const isSlugAvailable = useCallback(async (slug: string): Promise<boolean> => {
    if (!isApiConfigured) throw new Error(CONFIG_ERROR_MESSAGE);
    const { data } = await api.post<{ data: boolean }>("/profiles/rpc/is_slug_available", { slug });
    return data === true;
  }, []);

  const updateProfileInfo = useCallback(async (payload: {
    businessName?: string; email?: string; slug?: string;
  }): Promise<AuthResult> => {
    if (!isApiConfigured) return { ok: false, error: CONFIG_ERROR_MESSAGE };
    if (!currentUser) return { ok: false, error: PROFILE_UPDATE_ERROR };
    const updates: Record<string, string> = {};
    if (payload.businessName?.trim()) updates.business_name = payload.businessName.trim();
    if (payload.email?.trim()) updates.email = payload.email.trim().toLowerCase();
    if (payload.slug?.trim()) updates.slug = normalizeSlug(payload.slug);
    try {
      await api.patch(`/profiles/${currentUser.id}`, updates);
      await refreshProfile();
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError) return { ok: false, error: err.message };
      return { ok: false, error: PROFILE_UPDATE_ERROR };
    }
  }, [currentUser, refreshProfile]);

  const updatePassword = useCallback(async (newPassword: string): Promise<AuthResult> => {
    if (!isApiConfigured) return { ok: false, error: CONFIG_ERROR_MESSAGE };
    if (newPassword.length < 6) return { ok: false, error: "New password must be at least 6 characters." };
    try {
      await api.post("/auth/password", { password: newPassword });
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError) return { ok: false, error: err.message };
      return { ok: false, error: PASSWORD_UPDATE_ERROR };
    }
  }, []);

  const resetPassword = useCallback(async (_email: string): Promise<AuthResult> => {
    return { ok: false, error: "Password reset by email is currently disabled. Contact support." };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      currentUser,
      currentOwner,
      isOwner: currentUser?.role === "owner",
      isStaff: currentUser?.role === "staff",
      isEmailVerified: true,
      loading,
      staffAccounts,
      login,
      loginStaff,
      signup,
      loginDemo,
      createStaff,
      updateStaffPin,
      setStaffAccess,
      deleteStaff,
      deleteAccount,
      logout,
      resendVerificationEmail,
      isSlugAvailable,
      updateProfileInfo,
      updatePassword,
      resetPassword,
      refreshProfile,
    }),
    [
      currentUser, currentOwner, loading, staffAccounts,
      login, loginStaff, signup, loginDemo, createStaff,
      updateStaffPin, setStaffAccess, deleteStaff, deleteAccount, logout,
      resendVerificationEmail, isSlugAvailable, updateProfileInfo,
      updatePassword, resetPassword, refreshProfile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};
