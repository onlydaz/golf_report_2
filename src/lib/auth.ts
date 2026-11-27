import { invoke } from "@tauri-apps/api/core";

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: "ADMIN" | "OPERATOR";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const roleLabel = (role: User["role"]) => role === "ADMIN" ? "Quản trị viên" : "Người vận hành";

export const authApi = {
  me: () => invoke<User | null>("auth_me"),
  login: (username: string, password: string) => invoke<User>("auth_login", { username, password }),
  logout: () => invoke<void>("auth_logout"),
  changePassword: (currentPassword: string, newPassword: string) =>
    invoke<User>("auth_change_password", { currentPassword, newPassword }),
};

export const usersApi = {
  list: () => invoke<User[]>("users_list"),
  create: (username: string, displayName: string, password: string) =>
    invoke<void>("users_create", { username, displayName, password }),
  update: (id: number, displayName: string) => invoke<void>("users_update", { id, displayName }),
  resetPassword: (id: number, password: string) => invoke<void>("users_reset_password", { id, password }),
  setActive: (id: number, isActive: boolean) => invoke<void>("users_set_active", { id, isActive }),
};
