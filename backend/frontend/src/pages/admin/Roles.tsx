import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield, KeyRound, Users, Loader2, Pencil, Trash2, Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  createAdminRole,
  deleteAdminRole,
  fetchAdminRoles,
  updateAdminRole,
  setRolePermissions,
} from "@/lib/api-client";
import type { AdminRole } from "@/lib/types";
import { toast } from "@/components/ui/sonner";

type RoleDialogMode = "create" | "edit";
type RoleFormState = {
  name: string;
  description: string;
  permissions: string;
};

const normalizePermissionInput = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const defaultForm: RoleFormState = {
  name: "",
  description: "",
  permissions: "",
};

const formatDate = (iso: string | undefined) => {
  if (!iso) return "unknown";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

export default function Roles() {
  const queryClient = useQueryClient();
  const { data: roles = [], isLoading } = useQuery<AdminRole[]>({
    queryKey: ["admin-roles"],
    queryFn: fetchAdminRoles,
    staleTime: 60_000,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<RoleDialogMode>("create");
  const [editingRole, setEditingRole] = useState<AdminRole | null>(null);
  const [formState, setFormState] = useState<RoleFormState>(defaultForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminRole | null>(null);

  const permissionCount = useMemo(() => {
    const unique = new Set<string>();
    roles.forEach((role) => role.permissions?.forEach((perm) => unique.add(perm.code)));
    return unique.size;
  }, [roles]);

  useEffect(() => {
    if (!dialogOpen) {
      setEditingRole(null);
      setFormState(defaultForm);
      setFormError(null);
      setIsSubmitting(false);
    }
  }, [dialogOpen]);

  const openCreateDialog = () => {
    setDialogMode("create");
    setEditingRole(null);
    setFormState(defaultForm);
    setDialogOpen(true);
  };

  const openEditDialog = (role: AdminRole) => {
    setDialogMode("edit");
    setEditingRole(role);
    setFormState({
      name: role.name,
      description: role.description ?? "",
      permissions: (role.permissions ?? []).map((perm) => perm.code).join("\n"),
    });
    setDialogOpen(true);
  };

  const saveRoleMutation = useMutation({
    mutationFn: async () => {
      const name = formState.name.trim();
      if (!name) {
        throw new Error("Role name is required.");
      }
      const description = formState.description.trim();
      const permissionCodes = normalizePermissionInput(formState.permissions);

      let role: AdminRole;
      if (dialogMode === "create") {
        role = await createAdminRole({
          name,
          description: description ? description : undefined,
        });
        if (permissionCodes.length > 0) {
          role = await setRolePermissions(role.id, permissionCodes);
        }
      } else {
        if (!editingRole) {
          throw new Error("Missing role context.");
        }
        role = await updateAdminRole(editingRole.id, {
          name,
          description: description ? description : null,
        });
        const existingCodes = (editingRole.permissions ?? []).map((perm) => perm.code).sort();
        const updatedCodes = [...permissionCodes].sort();
        const differs =
          existingCodes.length !== updatedCodes.length ||
          existingCodes.some((code, idx) => code !== updatedCodes[idx]);
        if (differs) {
          role = await setRolePermissions(editingRole.id, permissionCodes);
        }
      }
      return role;
    },
    onSuccess: () => {
      toast("Role saved successfully.");
      queryClient.invalidateQueries({ queryKey: ["admin-roles"] });
      setDialogOpen(false);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to save role.";
      setFormError(message);
    },
    onSettled: () => {
      setIsSubmitting(false);
    },
  });

  const handleSubmit = () => {
    setFormError(null);
    setIsSubmitting(true);
    saveRoleMutation.mutate();
  };

  const deleteRoleMutation = useMutation({
    mutationFn: async (role: AdminRole) => {
      await deleteAdminRole(role.id);
    },
    onSuccess: () => {
      toast("Role deleted.");
      queryClient.invalidateQueries({ queryKey: ["admin-roles"] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to delete role.";
      toast(message);
    },
    onSettled: () => {
      setDeleteTarget(null);
    },
  });

  const confirmDeleteRole = () => {
    if (!deleteTarget) return;
    deleteRoleMutation.mutate(deleteTarget);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Role Management</h1>
          <p className="text-muted-foreground">
            Data pulled from <code className="font-mono text-xs">/api/v1/admin/roles</code>.
          </p>
        </div>
        <Button className="gap-2" onClick={openCreateDialog}>
          <Plus className="w-4 h-4" />
          Create Role
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {[
          { label: "Total Roles", value: roles.length.toString(), icon: Shield },
          { label: "Unique Permissions", value: permissionCount.toString(), icon: KeyRound },
          {
            label: "Average Permissions per Role",
            value: roles.length ? (permissionCount / roles.length).toFixed(1) : "0.0",
            icon: Users,
          },
        ].map((stat) => (
          <Card key={stat.label} className="glass-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
              <stat.icon className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Roles</CardTitle>
          <CardDescription>Permissions mirror the backend seed configuration.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-full overflow-x-auto rounded-lg border border-border/40">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      Loading roles...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && roles.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      No roles found.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  roles.map((role) => (
                    <TableRow key={role.id} className="hover:bg-muted/50">
                      <TableCell className="font-semibold capitalize flex items-center gap-2">
                        <Shield className="w-4 h-4 text-primary" />
                        {role.name}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {role.description || "--"}
                      </TableCell>
                      <TableCell>
                        {role.permissions && role.permissions.length > 0 ? (
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="sm">
                                {role.permissions.length} permissions
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-lg glass-card">
                              <DialogHeader>
                                <DialogTitle>{role.name} permissions</DialogTitle>
                                <DialogDescription>
                                  List of permission codes attached to this role.
                                </DialogDescription>
                              </DialogHeader>
                              <div className="grid gap-2 max-h-[400px] overflow-auto">
                                {role.permissions.map((perm) => (
                                  <div
                                    key={perm.id}
                                    className="flex items-center justify-between rounded border border-border/40 px-3 py-2"
                                  >
                                    <code className="text-xs">{perm.code}</code>
                                    <span className="text-xs text-muted-foreground">{perm.description ?? "--"}</span>
                                  </div>
                                ))}
                              </div>
                            </DialogContent>
                          </Dialog>
                        ) : (
                          <Badge variant="outline">No permissions</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(role.created_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(role.updated_at)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={() => openEditDialog(role)}>
                            <Pencil className="w-4 h-4" />
                            <span className="sr-only">Edit role</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteTarget(role)}
                            disabled={deleteRoleMutation.isLoading && deleteTarget?.id === role.id}
                          >
                            {deleteRoleMutation.isLoading && deleteTarget?.id === role.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                            <span className="sr-only">Delete role</span>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg glass-card">
          <DialogHeader>
            <DialogTitle>{dialogMode === "create" ? "Create role" : `Edit role: ${editingRole?.name ?? ""}`}</DialogTitle>
            <DialogDescription>
              {dialogMode === "create"
                ? "Define a new role and optionally seed its permissions."
                : "Update role details and adjust assigned permission codes."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="role-name">Role name</Label>
              <Input
                id="role-name"
                value={formState.name}
                onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="e.g. analyst"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role-description">Description</Label>
              <Input
                id="role-description"
                value={formState.description}
                onChange={(event) => setFormState((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Optional summary of role purpose"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role-permissions">Permission codes (one per line)</Label>
              <Textarea
                id="role-permissions"
                value={formState.permissions}
                onChange={(event) => setFormState((prev) => ({ ...prev, permissions: event.target.value }))}
                placeholder="user:read&#10;user:update&#10;role:read"
                rows={6}
              />
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role</AlertDialogTitle>
            <AlertDialogDescription>
              This action will remove the role {deleteTarget?.name}. Users assigned to this role will lose the related
              permissions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteRoleMutation.isLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteRole} disabled={deleteRoleMutation.isLoading}>
              {deleteRoleMutation.isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
