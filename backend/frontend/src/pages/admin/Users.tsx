import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Shield, Users as UsersIcon, UserPlus, Loader2, Pencil, Trash2, Coins } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  assignUserRoles,
  createAdminUser,
  deleteAdminUser,
  fetchAdminRoles,
  fetchAdminUser,
  fetchAdminUsers,
  removeUserRoles,
  updateAdminUser,
  updateAdminUserCoins,
} from "@/lib/api-client";
import type { AdminRole, AdminUser, AdminUsersResponse } from "@/lib/types";
import { toast } from "@/components/ui/sonner";
import { Slab } from "react-loading-indicators";

const initials = (name: string | null, fallback: string) => {
  const base = name || fallback;
  return base
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
};

type CreateUserFormState = {
  discord_id: string;
  username: string;
  email: string;
  display_name: string;
  avatar_url: string;
  phone_number: string;
};

type ManageUserFormState = {
  username: string;
  email: string;
  display_name: string;
  avatar_url: string;
  phone_number: string;
};

const defaultCreateState: CreateUserFormState = {
  discord_id: "",
  username: "",
  email: "",
  display_name: "",
  avatar_url: "",
  phone_number: "",
};

const defaultManageState: ManageUserFormState = {
  username: "",
  email: "",
  display_name: "",
  avatar_url: "",
  phone_number: "",
};

export default function Users() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<AdminUsersResponse>({
    queryKey: ["admin-users", search],
    queryFn: () => fetchAdminUsers({ q: search || undefined, page_size: 50 }),
    keepPreviousData: true,
  });

  const users = useMemo(() => data?.items ?? [], [data?.items]);

  const { data: roleOptions = [] } = useQuery<AdminRole[]>({
    queryKey: ["admin-roles"],
    queryFn: fetchAdminRoles,
    staleTime: 60_000,
  });

  const aggregates = useMemo(() => {
    const total = data?.total ?? users.length;
    const admins = users.filter((user) => user.roles.some((role) => role.name === "admin")).length;
    const moderators = users.filter((user) => user.roles.some((role) => role.name === "moderator")).length;
    return { total, admins, moderators };
  }, [data?.total, users]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserFormState>(defaultCreateState);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [manageOpen, setManageOpen] = useState(false);
  const [manageUserId, setManageUserId] = useState<string | null>(null);
  const [manageForm, setManageForm] = useState<ManageUserFormState>(defaultManageState);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [manageError, setManageError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  const [coinEditUserId, setCoinEditUserId] = useState<string | null>(null);
  const [coinForm, setCoinForm] = useState({ coins: 0, operation: "set", reason: "" });
  const [coinOpen, setCoinOpen] = useState(false);

  const manageUserQuery = useQuery({
    queryKey: ["admin-user", manageUserId],
    queryFn: () => fetchAdminUser(manageUserId!),
    enabled: manageOpen && Boolean(manageUserId),
  });

  useEffect(() => {
    if (!createOpen) {
      setCreateForm(defaultCreateState);
      setCreateError(null);
      setIsCreating(false);
    }
  }, [createOpen]);

  useEffect(() => {
    if (!manageOpen) {
      setManageUserId(null);
      setManageForm(defaultManageState);
      setSelectedRoleIds([]);
      setManageError(null);
      setIsSaving(false);
    }
  }, [manageOpen]);

  useEffect(() => {
    const user = manageUserQuery.data;
    if (user) {
      setManageForm({
        username: user.username ?? "",
        email: user.email ?? "",
        display_name: user.display_name ?? "",
        avatar_url: user.avatar_url ?? "",
        phone_number: user.phone_number ?? "",
      });
      setSelectedRoleIds(user.roles.map((role) => role.id));
      setManageError(null);
      setIsSaving(false);
    }
  }, [manageUserQuery.data]);

  useEffect(() => {
    if (manageOpen && !manageUserQuery.isLoading && manageUserId && manageUserQuery.data === null) {
      setManageError("Không tải được chi tiết người dùng hoặc không có quyền truy cập.");
    }
  }, [manageOpen, manageUserQuery.data, manageUserQuery.isLoading, manageUserId]);

  const handleCreateUser = async () => {
    setCreateError(null);
    if (!createForm.discord_id.trim() || !createForm.username.trim()) {
      setCreateError("Bắt buộc nhập Discord ID và tên đăng nhập.");
      return;
    }
    setIsCreating(true);
    try {
      await createAdminUser({
        discord_id: createForm.discord_id.trim(),
        username: createForm.username.trim(),
        email: createForm.email.trim() || undefined,
        display_name: createForm.display_name.trim() || undefined,
        avatar_url: createForm.avatar_url.trim() || undefined,
        phone_number: createForm.phone_number.trim() || undefined,
      });
      toast("Đã tạo người dùng.");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setCreateOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tạo người dùng thất bại.";
      setCreateError(message);
    } finally {
      setIsCreating(false);
    }
  };

  const toggleRoleSelection = (roleId: string) => {
    setSelectedRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
    );
  };

  const handleSaveUser = async () => {
    const original = manageUserQuery.data;
    if (!manageUserId || !original) {
      return;
    }
    if (!manageForm.username.trim()) {
      setManageError("Tên đăng nhập không được để trống.");
      return;
    }
    setManageError(null);
    setIsSaving(true);

    try {
      const payload: Partial<ManageUserFormState> = {};
      if (manageForm.username.trim() !== (original.username ?? "")) {
        payload.username = manageForm.username.trim();
      }
      if (manageForm.email.trim() !== (original.email ?? "")) {
        payload.email = manageForm.email.trim() || null;
      }
      if (manageForm.display_name.trim() !== (original.display_name ?? "")) {
        payload.display_name = manageForm.display_name.trim() || null;
      }
      if (manageForm.avatar_url.trim() !== (original.avatar_url ?? "")) {
        payload.avatar_url = manageForm.avatar_url.trim() || null;
      }
      if (manageForm.phone_number.trim() !== (original.phone_number ?? "")) {
        payload.phone_number = manageForm.phone_number.trim() || null;
      }

      if (Object.keys(payload).length > 0) {
        await updateAdminUser(manageUserId, payload);
      }

      const currentRoleIds = new Set(original.roles.map((role) => role.id));
      const desiredRoleIds = new Set(selectedRoleIds);
      const toAdd = Array.from(desiredRoleIds).filter((id) => !currentRoleIds.has(id));
      const toRemove = Array.from(currentRoleIds).filter((id) => !desiredRoleIds.has(id));

      if (toAdd.length > 0) {
        await assignUserRoles(manageUserId, toAdd);
      }
      if (toRemove.length > 0) {
        await removeUserRoles(manageUserId, toRemove);
      }

      toast("Đã cập nhật người dùng.");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-user", manageUserId] });
      setManageOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cập nhật người dùng thất bại.";
      setManageError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveCoins = async () => {
    if (!coinEditUserId) {
      return;
    }
    if (coinForm.coins < 0) {
      toast("Số lượng không được âm.");
      return;
    }
    try {
      await updateAdminUserCoins(coinEditUserId, {
        op: coinForm.operation as "add" | "sub" | "set",
        amount: coinForm.coins,
        reason: coinForm.reason || null,
      });
      toast("Đã cập nhật số xu.");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setCoinOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cập nhật xu thất bại.";
      toast(message);
    }
  };

  useEffect(() => {
    if (!coinOpen) {
      setCoinEditUserId(null);
      setCoinForm({ coins: 0, operation: "set", reason: "" });
    }
  }, [coinOpen]);

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      await deleteAdminUser(userId);
    },
    onSuccess: () => {
      toast("Đã xóa người dùng.");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Xóa người dùng thất bại.";
      toast(message);
    },
    onSettled: () => {
      setDeleteTarget(null);
    },
  });

  const confirmDeleteUser = () => {
    if (!deleteTarget) return;
    deleteUserMutation.mutate(deleteTarget.id);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Quản lý người dùng</h1>
          <p className="text-muted-foreground">
            Dữ liệu lấy từ <code className="font-mono text-xs">/api/v1/admin/users</code>.
          </p>
        </div>
        <Button className="gap-2" onClick={() => setCreateOpen(true)}>
          <UserPlus className="w-4 h-4" />
          Thêm người dùng
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {[
          {
            label: "Tổng số người dùng",
            value: aggregates.total.toLocaleString(),
            icon: UsersIcon,
            description: "Phân trang qua admin API",
          },
          {
            label: "Quản trị viên",
            value: aggregates.admins.toString(),
            icon: Shield,
            description: "Tài khoản có vai trò admin",
          },
          {
            label: "Điều hành viên",
            value: aggregates.moderators.toString(),
            icon: Shield,
            description: "Tài khoản có vai trò moderator",
          },
        ].map((stat) => (
          <Card key={stat.label} className="glass-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
              <stat.icon className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="glass-card">
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Danh sách người dùng</CardTitle>
              <CardDescription>
                Hiển thị từ <code className="font-mono text-xs">/api/v1/admin/users</code>.
              </CardDescription>
            </div>
            <div className="relative w-full md:w-[300px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Tìm theo username hoặc email..."
                className="pl-9 glass-card"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto rounded-lg border border-border/40">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Người dùng</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Vai trò</TableHead>
                  <TableHead>Discord ID</TableHead>
                  <TableHead className="w-[120px] text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      <Slab color="#d18d00" size="large" text="Đang tải nội dung từ server" textColor="" />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      Không tìm thấy người dùng phù hợp.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  users.map((user) => (
                    <TableRow key={user.id} className="hover:bg-muted/50">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="w-8 h-8">
                            {user.avatar_url ? (
                              <AvatarImage src={user.avatar_url} alt={user.display_name ?? user.username} />
                            ) : (
                              <AvatarFallback>{initials(user.display_name, user.username)}</AvatarFallback>
                            )}
                          </Avatar>
                          <div>
                            <p className="font-medium">{user.display_name || user.username}</p>
                            <p className="text-xs text-muted-foreground">@{user.username}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{user.email_masked ?? "--"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {user.roles.length === 0 && <Badge variant="outline">không</Badge>}
                          {user.roles.map((role) => (
                            <Badge key={role.id} variant={role.name === "admin" ? "default" : "secondary"}>
                              {role.name}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm font-mono">{user.discord_id_suffix ? `****${user.discord_id_suffix}` : "--"}</TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setCoinEditUserId(user.id);
                            setCoinForm({ coins: user.coins ?? 0, operation: "set", reason: "" });
                            setCoinOpen(true);
                          }}
                          className="text-green-600 hover:text-green-700"
                        >
                          <Coins className="w-4 h-4 mr-1" />
                          {user.coins ?? 0}
                        </Button>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setManageUserId(user.id);
                              setManageOpen(true);
                            }}
                          >
                            <Pencil className="w-4 h-4" />
                            <span className="sr-only">Chỉnh sửa</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteTarget(user)}
                            disabled={deleteUserMutation.status === "pending" && deleteTarget?.id === user.id}
                          >
                            {deleteUserMutation.status === "pending" && deleteTarget?.id === user.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                            <span className="sr-only">Xóa người dùng</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Tạo người dùng */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg glass-card">
          <DialogHeader>
            <DialogTitle>Thêm người dùng</DialogTitle>
            <DialogDescription>Nhập thông tin Discord để tạo hồ sơ người dùng quản trị.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="create-discord">Discord ID</Label>
              <Input
                id="create-discord"
                value={createForm.discord_id}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, discord_id: event.target.value }))}
                placeholder="8668472283421511782"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-username">Tên đăng nhập</Label>
              <Input
                id="create-username"
                value={createForm.username}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, username: event.target.value }))}
                placeholder="ten_dang_nhap"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-email">Email</Label>
              <Input
                id="create-email"
                type="email"
                value={createForm.email}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, email: event.target.value }))}
                placeholder="không bắt buộc"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-display-name">Tên hiển thị</Label>
              <Input
                id="create-display-name"
                value={createForm.display_name}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, display_name: event.target.value }))}
                placeholder="không bắt buộc"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-avatar">URL ảnh đại diện</Label>
              <Input
                id="create-avatar"
                value={createForm.avatar_url}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, avatar_url: event.target.value }))}
                placeholder="https://cdn.discordapp.com/..."
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-phone">Số điện thoại</Label>
              <Input
                id="create-phone"
                value={createForm.phone_number}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, phone_number: event.target.value }))}
                placeholder="không bắt buộc"
              />
            </div>
            {createError && <p className="text-sm text-destructive">{createError}</p>}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={isCreating}>
              Hủy
            </Button>
            <Button onClick={handleCreateUser} disabled={isCreating}>
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Tạo mới"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Chỉnh sửa người dùng */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-3xl glass-card">
          <DialogHeader>
            <DialogTitle>Cài đặt người dùng</DialogTitle>
            <DialogDescription>Cập nhật thông tin hồ sơ và gán/bỏ vai trò.</DialogDescription>
          </DialogHeader>

          {manageUserQuery.isLoading && (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!manageUserQuery.isLoading && manageUserQuery.data && (
            <div className="grid gap-6 md:grid-cols-[2fr,1fr]">
              <div className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="manage-username">Tên đăng nhập</Label>
                  <Input
                    id="manage-username"
                    value={manageForm.username}
                    onChange={(event) => setManageForm((prev) => ({ ...prev, username: event.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="manage-email">Email</Label>
                  <Input
                    id="manage-email"
                    type="email"
                    value={manageForm.email}
                    onChange={(event) => setManageForm((prev) => ({ ...prev, email: event.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="manage-display-name">Tên hiển thị</Label>
                  <Input
                    id="manage-display-name"
                    value={manageForm.display_name}
                    onChange={(event) => setManageForm((prev) => ({ ...prev, display_name: event.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="manage-avatar">URL ảnh đại diện</Label>
                  <Input
                    id="manage-avatar"
                    value={manageForm.avatar_url}
                    onChange={(event) => setManageForm((prev) => ({ ...prev, avatar_url: event.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="manage-phone">Số điện thoại</Label>
                  <Input
                    id="manage-phone"
                    value={manageForm.phone_number}
                    onChange={(event) => setManageForm((prev) => ({ ...prev, phone_number: event.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Vai trò</h3>
                <div className="space-y-2 rounded-lg border border-border/40 p-3 max-h-[360px] overflow-auto">
                  {roleOptions.length === 0 && (
                    <p className="text-xs text-muted-foreground">Chưa có vai trò nào.</p>
                  )}
                  {roleOptions.map((role) => (
                    <label key={role.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedRoleIds.includes(role.id)}
                        onCheckedChange={() => toggleRoleSelection(role.id)}
                      />
                      <span className="font-medium capitalize">{role.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {manageError && <p className="text-sm text-destructive">{manageError}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setManageOpen(false)} disabled={isSaving}>
              Hủy
            </Button>
            <Button onClick={handleSaveUser} disabled={isSaving || manageUserQuery.isLoading}>
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Lưu thay đổi"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Xác nhận xóa */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa người dùng</AlertDialogTitle>
            <AlertDialogDescription>
              Thao tác này sẽ xóa tài khoản {deleteTarget?.username}. Mọi phiên hoạt động sẽ bị thu hồi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteUserMutation.status === "pending"}>Hủy</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteUser} disabled={deleteUserMutation.status === "pending"}>
              {deleteUserMutation.status === "pending" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Xóa"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Chỉnh sửa Xu */}
      <Dialog open={coinOpen} onOpenChange={setCoinOpen}>
        <DialogContent className="max-w-lg glass-card">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa số xu</DialogTitle>
            <DialogDescription>Điều chỉnh số dư xu của người dùng.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Thao tác</Label>
              <select
                value={coinForm.operation}
                onChange={(e) => setCoinForm({ ...coinForm, operation: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="set">Đặt bằng</option>
                <option value="add">Cộng thêm</option>
                <option value="sub">Trừ bớt</option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="coin-amount">Số lượng</Label>
              <Input
                id="coin-amount"
                type="number"
                value={coinForm.coins}
                onChange={(e) => setCoinForm({ ...coinForm, coins: parseInt(e.target.value) || 0 })}
                placeholder="Nhập số lượng"
                min="0"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="coin-reason">Lý do (không bắt buộc)</Label>
              <Input
                id="coin-reason"
                value={coinForm.reason}
                onChange={(e) => setCoinForm({ ...coinForm, reason: e.target.value })}
                placeholder="Lý do thay đổi"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setCoinOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleSaveCoins}>
              Cập nhật xu
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
