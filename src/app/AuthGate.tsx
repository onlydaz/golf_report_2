import { Spin } from "antd";
import { useAuth } from "./AuthProvider";
import { LiveProvider, useLiveRecipe } from "./LiveProvider";
import MainLayout from "../layouts/MainLayout";
import Login, { AuthScreen } from "../pages/Login/Login";
import ExitConfirmation from "./ExitConfirmation";

function AuthenticatedLayout() {
  const { draftDirty, applying } = useLiveRecipe();
  return <><ExitConfirmation draftDirty={draftDirty} applying={applying} /><MainLayout /></>;
}

export default function AuthGate() {
  const { user, ready } = useAuth();
  if (!ready) return <><ExitConfirmation /><AuthScreen><Spin aria-label="Đang kiểm tra đăng nhập" /></AuthScreen></>;
  if (!user) return <><ExitConfirmation /><Login /></>;
  // Unmount every business page/provider on logout, clearing forms and subscriptions.
  // Backend collection and production state live independently of this React tree.
  return <LiveProvider key={user.id}><AuthenticatedLayout /></LiveProvider>;
}
