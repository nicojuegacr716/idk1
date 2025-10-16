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
      setManageError("Unable to load user details or access denied.");
    }
  }, [manageOpen, manageUserQuery.data, manageUserQuery.isLoading, manageUserId]);

  const handleCreateUser = async () => {
    setCreateError(null);
    if (!createForm.discord_id.trim() || !createForm.username.trim()) {
      setCreateError("Discord ID and username are required.");
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
      toast("User created.");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setCreateOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create user.";
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
      setManageError("Username cannot be empty.");
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

      toast("User updated.");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-user", manageUserId] });
      setManageOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update user.";
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
      toast("Amount cannot be negative.");
      return;
    }
    try {
      await updateAdminUserCoins(coinEditUserId, {
        op: coinForm.operation as "add" | "sub" | "set",
        amount: coinForm.coins,
        reason: coinForm.reason || null,
      });
      toast("Coins updated successfully.");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setCoinOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update coins.";
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
      toast("User deleted.");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to delete user.";
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
          <h1 className="text-3xl font-bold mb-2">User Management</h1>
          <p className="text-muted-foreground">
            Data is sourced from <code className="font-mono text-xs">/api/v1/admin/users</code>.
          </p>
        </div>
        <Button className="gap-2" onClick={() => setCreateOpen(true)}>
          <UserPlus className="w-4 h-4" />
          Add User
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {[
          {
            label: "Total Users",
            value: aggregates.total.toLocaleString(),
            icon: UsersIcon,
            description: "Paginated via admin API",
          },
          {
            label: "Admins",
            value: aggregates.admins.toString(),
            icon: Shield,
            description: "Users with the admin role",
          },
          {
            label: "Moderators",
            value: aggregates.moderators.toString(),
            icon: Shield,
            description: "Users with the moderator role",
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
              <CardTitle>Users</CardTitle>
              <CardDescription>
                Showing records from <code className="font-mono text-xs">/api/v1/admin/users</code>.
              </CardDescription>
            </div>
            <div className="relative w-full md:w-[300px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by username or email..."
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
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Discord ID</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      Loading users...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      No users match this query.
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
                          {user.roles.length === 0 && <Badge variant="outline">none</Badge>}
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
                            <span className="sr-only">Manage user</span>
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
                            <span className="sr-only">Delete user</span>
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg glass-card">
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>Provide the Discord details to create an admin user record.</DialogDescription>
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
              <Label htmlFor="create-username">Username</Label>
              <Input
                id="create-username"
                value={createForm.username}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, username: event.target.value }))}
                placeholder="username"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-email">Email</Label>
              <Input
                id="create-email"
                type="email"
                value={createForm.email}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, email: event.target.value }))}
                placeholder="optional"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-display-name">Display name</Label>
              <Input
                id="create-display-name"
                value={createForm.display_name}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, display_name: event.target.value }))}
                placeholder="optional"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-avatar">Avatar URL</Label>
              <Input
                id="create-avatar"
                value={createForm.avatar_url}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, avatar_url: event.target.value }))}
                placeholder="https://cdn.discordapp.com/..."
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-phone">Phone number</Label>
              <Input
                id="create-phone"
                value={createForm.phone_number}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, phone_number: event.target.value }))}
                placeholder="optional"
              />
            </div>
            {createError && <p className="text-sm text-destructive">{createError}</p>}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={isCreating}>
              Cancel
            </Button>
            <Button onClick={handleCreateUser} disabled={isCreating}>
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-3xl glass-card">
          <DialogHeader>
            <DialogTitle>User settings</DialogTitle>
            <DialogDescription>Update profile fields and adjust role assignments.</DialogDescription>
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
                  <Label htmlFor="manage-username">Username</Label>
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
                  <Label htmlFor="manage-display-name">Display name</Label>
                  <Input
                    id="manage-display-name"
                    value={manageForm.display_name}
                    onChange={(event) => setManageForm((prev) => ({ ...prev, display_name: event.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="manage-avatar">Avatar URL</Label>
                  <Input
                    id="manage-avatar"
                    value={manageForm.avatar_url}
                    onChange={(event) => setManageForm((prev) => ({ ...prev, avatar_url: event.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="manage-phone">Phone number</Label>
                  <Input
                    id="manage-phone"
                    value={manageForm.phone_number}
                    onChange={(event) => setManageForm((prev) => ({ ...prev, phone_number: event.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Roles</h3>
                <div className="space-y-2 rounded-lg border border-border/40 p-3 max-h-[360px] overflow-auto">
                  {roleOptions.length === 0 && (
                    <p className="text-xs text-muted-foreground">No roles available.</p>
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
              Cancel
            </Button>
            <Button onClick={handleSaveUser} disabled={isSaving || manageUserQuery.isLoading}>
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the account {deleteTarget?.username}. Any active sessions will be revoked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteUserMutation.status === "pending"}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirmDeleteUser} disabled={deleteUserMutation.status === "pending"}>
            {deleteUserMutation.status === "pending" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={coinOpen} onOpenChange={setCoinOpen}>
        <DialogContent className="max-w-lg glass-card">
          <DialogHeader>
            <DialogTitle>Edit User Coins</DialogTitle>
            <DialogDescription>Adjust user coin balance.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Operation</Label>
              <select
                value={coinForm.operation}
                onChange={(e) => setCoinForm({ ...coinForm, operation: e.target.value })}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="set">Set to</option>
                <option value="add">Add</option>
                <option value="sub">Subtract</option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="coin-amount">Amount</Label>
              <Input
                id="coin-amount"
                type="number"
                value={coinForm.coins}
                onChange={(e) => setCoinForm({ ...coinForm, coins: parseInt(e.target.value) || 0 })}
                placeholder="Enter amount"
                min="0"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="coin-reason">Reason (optional)</Label>
              <Input
                id="coin-reason"
                value={coinForm.reason}
                onChange={(e) => setCoinForm({ ...coinForm, reason: e.target.value })}
                placeholder="Reason for change"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setCoinOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveCoins}>
              Update Coins
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
