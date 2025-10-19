import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import {
  createAdminVpsProduct,
  deactivateAdminVpsProduct,
  deleteAdminVpsProduct,
  fetchAdminVpsProducts,
  fetchWorkers,
  updateAdminVpsProduct,
} from "@/lib/api-client";
import type { VpsProduct, WorkerInfo } from "@/lib/types";
import { Archive, Loader2, Pencil, PlusCircle, Power, Trash2 } from "lucide-react";
import { Slab } from "react-loading-indicators";

type ProductFormState = {
  name: string;
  description: string;
  price_coins: string;
  provision_action: string;
  is_active: boolean;
  worker_ids: string[];
};

const emptyForm: ProductFormState = {
  name: "",
  description: "",
  price_coins: "0",
  provision_action: "1",
  is_active: true,
  worker_ids: [],
};

const parseNonNegativeInt = (value: string): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.round(parsed);
};

const parsePositiveInt = (value: string): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return Math.floor(parsed);
};

const productStatus = (product: VpsProduct) =>
  product.is_active ? (
    <Badge variant="default">Active</Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Archived
    </Badge>
  );

const workerBadge = (worker: WorkerInfo) => (
  <Badge key={worker.id} variant="outline" className="capitalize">
    {worker.name || worker.base_url} · {worker.active_sessions}/{worker.max_sessions}
  </Badge>
);

export default function AdminVpsProducts() {
  const queryClient = useQueryClient();
  const [showInactive, setShowInactive] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<VpsProduct | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VpsProduct | null>(null);

  const [createForm, setCreateForm] = useState<ProductFormState>(emptyForm);
  const [editForm, setEditForm] = useState<ProductFormState>(emptyForm);

  const productsQuery = useQuery({
    queryKey: ["admin-vps-products", showInactive ? "all" : "active"],
    queryFn: () => fetchAdminVpsProducts({ includeInactive: showInactive }),
    keepPreviousData: true,
  });

  const { data: workerOptions = [], isLoading: workersLoading } = useQuery<WorkerInfo[]>({
    queryKey: ["admin-workers", "options"],
    queryFn: fetchWorkers,
    staleTime: 60_000,
  });

  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);

  useEffect(() => {
    if (!createOpen) {
      setCreateForm(emptyForm);
      setCreateError(null);
    }
  }, [createOpen]);

  useEffect(() => {
    if (!editOpen) {
      setEditTarget(null);
      setEditForm(emptyForm);
      setEditError(null);
      return;
    }
    if (editTarget) {
      setEditForm({
        name: editTarget.name ?? "",
        description: editTarget.description ?? "",
        price_coins: String(editTarget.price_coins ?? 0),
        provision_action: String(editTarget.provision_action ?? 1),
        is_active: Boolean(editTarget.is_active),
        worker_ids: (editTarget.workers ?? []).map((worker) => worker.id),
      });
    }
  }, [editOpen, editTarget]);

  const invalidateProducts = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-vps-products"] });
  };

  const createMutation = useMutation({
    mutationFn: async (formState: ProductFormState) => {
      const price = parseNonNegativeInt(formState.price_coins);
      if (price === null) {
        throw new Error("Price must be a non-negative number.");
      }
      const action = parsePositiveInt(formState.provision_action);
      if (action === null) {
        throw new Error("Provision action must be a positive integer.");
      }
      return createAdminVpsProduct({
        name: formState.name.trim(),
        description: formState.description.trim() || null,
        price_coins: price,
        provision_action: action,
        is_active: formState.is_active,
        worker_ids: formState.worker_ids,
      });
    },
    onSuccess: () => {
      toast("Product created.");
      invalidateProducts();
      setCreateOpen(false);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to create product.";
      setCreateError(message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, formState, original }: { id: string; formState: ProductFormState; original: VpsProduct }) => {
      const payload: Record<string, unknown> = {};
      if (formState.name.trim() !== (original.name ?? "")) {
        payload.name = formState.name.trim();
      }
      if (formState.description.trim() !== (original.description ?? "")) {
        payload.description = formState.description.trim() || null;
      }
      const price = parseNonNegativeInt(formState.price_coins);
      if (price === null) {
        throw new Error("Price must be a non-negative number.");
      }
      if (price !== original.price_coins) {
        payload.price_coins = price;
      }
      const action = parsePositiveInt(formState.provision_action);
      if (action === null) {
        throw new Error("Provision action must be a positive integer.");
      }
      if (action !== (original.provision_action ?? 1)) {
        payload.provision_action = action;
      }
      if (formState.is_active !== Boolean(original.is_active)) {
        payload.is_active = formState.is_active;
      }
      const currentIds = new Set((original.workers ?? []).map((worker) => worker.id));
      const desiredIds = new Set(formState.worker_ids);
      const sameSize = currentIds.size === desiredIds.size;
      let workersChanged = !sameSize;
      if (sameSize) {
        for (const id of currentIds) {
          if (!desiredIds.has(id)) {
            workersChanged = true;
            break;
          }
        }
      }
      if (workersChanged) {
        payload.worker_ids = Array.from(desiredIds);
      }
      if (Object.keys(payload).length === 0) {
        return original;
      }
      return updateAdminVpsProduct(id, payload);
    },
    onSuccess: () => {
      toast("Product updated.");
      invalidateProducts();
      setEditOpen(false);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to update product.";
      setEditError(message);
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (product: VpsProduct) => {
      if (product.is_active) {
        return deactivateAdminVpsProduct(product.id);
      }
      return updateAdminVpsProduct(product.id, { is_active: true });
    },
    onSuccess: () => {
      invalidateProducts();
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to update product status.";
      toast(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (productId: string) => deleteAdminVpsProduct(productId),
    onSuccess: () => {
      toast("Product deleted.");
      invalidateProducts();
      setDeleteTarget(null);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to delete product.";
      toast(message);
    },
    onSettled: () => {
      setDeleteTarget(null);
    },
  });

  const handleCreateSubmit = () => {
    setCreateError(null);
    createMutation.mutate(createForm);
  };

  const handleEditSubmit = () => {
    if (!editTarget) return;
    setEditError(null);
    updateMutation.mutate({ id: editTarget.id, formState: editForm, original: editTarget });
  };

  const toggleCreateWorker = (workerId: string) => {
    setCreateForm((prev) => {
      const exists = prev.worker_ids.includes(workerId);
      return {
        ...prev,
        worker_ids: exists ? prev.worker_ids.filter((id) => id !== workerId) : [...prev.worker_ids, workerId],
      };
    });
  };

  const toggleEditWorker = (workerId: string) => {
    setEditForm((prev) => {
      const exists = prev.worker_ids.includes(workerId);
      return {
        ...prev,
        worker_ids: exists ? prev.worker_ids.filter((id) => id !== workerId) : [...prev.worker_ids, workerId],
      };
    });
  };

  const busy =
    productsQuery.isLoading ||
    createMutation.isLoading ||
    updateMutation.isLoading ||
    statusMutation.isLoading ||
    deleteMutation.isLoading;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">VPS Products</h1>
          <p className="text-muted-foreground">Manage the offerings exposed through <code className="font-mono text-xs">/vps/products</code>.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
            <Switch
              checked={showInactive}
              onCheckedChange={(value) => setShowInactive(Boolean(value))}
              aria-label="Show archived products"
            />
            <span className="text-sm text-muted-foreground">Show archived</span>
          </div>
          <Button className="gap-2" onClick={() => setCreateOpen(true)}>
            <PlusCircle className="h-4 w-4" />
            New Product
          </Button>
        </div>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Catalog</CardTitle>
          <CardDescription>Includes active and archived products depending on the filter. Prices are stored in coins.</CardDescription>
        </CardHeader>
        <CardContent>
          {productsQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Slab color="#d18d00" size="large" text="Đang tải nội dung từ server" textColor="" />
            </div>
          ) : products.length === 0 ? (
            <p className="text-sm text-muted-foreground">No products found. Create one to get started.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-24">Price</TableHead>
                  <TableHead className="w-28">Provision</TableHead>
                  <TableHead className="w-48">Workers</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead className="w-48">Updated</TableHead>
                  <TableHead className="w-40 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow key={product.id} className={!product.is_active ? "opacity-70" : undefined}>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {product.description || "—"}
                    </TableCell>
                    <TableCell>{product.price_coins.toLocaleString()}</TableCell>
                    <TableCell>{product.provision_action ?? 1}</TableCell>
                    <TableCell className="space-x-1 space-y-1">
                      {product.workers && product.workers.length > 0
                        ? product.workers.map((worker) => workerBadge(worker))
                        : <span className="text-xs text-muted-foreground">None</span>}
                    </TableCell>
                    <TableCell>{productStatus(product)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {product.updated_at
                        ? formatDistanceToNow(new Date(product.updated_at), { addSuffix: true })
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditTarget(product);
                            setEditOpen(true);
                          }}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </Button>
                        <Button
                          variant={product.is_active ? "destructive" : "secondary"}
                          size="sm"
                          onClick={() => statusMutation.mutate(product)}
                          disabled={statusMutation.isLoading}
                        >
                          {product.is_active ? (
                            <>
                              <Archive className="mr-2 h-4 w-4" />
                              Archive
                            </>
                          ) : (
                            <>
                              <Power className="mr-2 h-4 w-4" />
                              Activate
                            </>
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive border-destructive/40"
                          onClick={() => setDeleteTarget(product)}
                          disabled={deleteMutation.isLoading}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg glass-card">
          <DialogHeader>
            <DialogTitle>Create VPS product</DialogTitle>
            <DialogDescription>Define pricing and availability for the new product.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="create-name">Name</Label>
              <Input
                id="create-name"
                value={createForm.name}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Premium VPS"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-description">Description</Label>
              <Textarea
                id="create-description"
                value={createForm.description}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Describe the resources included..."
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-price">Price (coins)</Label>
              <Input
                id="create-price"
                type="number"
                min={0}
                value={createForm.price_coins}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, price_coins: event.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-action">Provision action</Label>
              <Input
                id="create-action"
                type="number"
                min={1}
                value={createForm.provision_action}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, provision_action: event.target.value }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2">
              <div>
                <Label htmlFor="create-active" className="text-sm font-medium">
                  Active
                </Label>
                <p className="text-xs text-muted-foreground">Inactive products are hidden from users.</p>
              </div>
              <Switch
                id="create-active"
                checked={createForm.is_active}
                onCheckedChange={(value) => setCreateForm((prev) => ({ ...prev, is_active: Boolean(value) }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Workers</Label>
              <div className="max-h-48 overflow-auto rounded-lg border border-border/40 p-3 space-y-2">
                {workersLoading ? (
                  <p className="text-xs text-muted-foreground">Loading workers...</p>
                ) : workerOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No workers registered.</p>
                ) : (
                  workerOptions.map((worker) => (
                    <label key={worker.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={createForm.worker_ids.includes(worker.id)}
                        onCheckedChange={() => toggleCreateWorker(worker.id)}
                      />
                      <span className="font-medium">{worker.name || worker.base_url}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            {createError && <p className="text-sm text-destructive">{createError}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={createMutation.isLoading}>
              Cancel
            </Button>
            <Button onClick={handleCreateSubmit} disabled={createMutation.isLoading}>
              {createMutation.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg glass-card">
          <DialogHeader>
            <DialogTitle>Edit VPS product</DialogTitle>
            <DialogDescription>Update details or availability for {editTarget?.name ?? "the product"}.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editForm.description}
                onChange={(event) => setEditForm((prev) => ({ ...prev, description: event.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-price">Price (coins)</Label>
              <Input
                id="edit-price"
                type="number"
                min={0}
                value={editForm.price_coins}
                onChange={(event) => setEditForm((prev) => ({ ...prev, price_coins: event.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-action">Provision action</Label>
              <Input
                id="edit-action"
                type="number"
                min={1}
                value={editForm.provision_action}
                onChange={(event) => setEditForm((prev) => ({ ...prev, provision_action: event.target.value }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2">
              <div>
                <Label htmlFor="edit-active" className="text-sm font-medium">
                  Active
                </Label>
                <p className="text-xs text-muted-foreground">Inactive products are hidden from users.</p>
              </div>
              <Switch
                id="edit-active"
                checked={editForm.is_active}
                onCheckedChange={(value) => setEditForm((prev) => ({ ...prev, is_active: Boolean(value) }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Workers</Label>
              <div className="max-h-48 overflow-auto rounded-lg border border-border/40 p-3 space-y-2">
                {workersLoading ? (
                  <p className="text-xs text-muted-foreground">Loading workers...</p>
                ) : workerOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No workers registered.</p>
                ) : (
                  workerOptions.map((worker) => (
                    <label key={worker.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={editForm.worker_ids.includes(worker.id)}
                        onCheckedChange={() => toggleEditWorker(worker.id)}
                      />
                      <span className="font-medium">{worker.name || worker.base_url}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={updateMutation.isLoading}>
              Cancel
            </Button>
            <Button onClick={handleEditSubmit} disabled={updateMutation.isLoading || !editTarget}>
              {updateMutation.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isLoading) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently remove {deleteTarget?.name ?? "this product"} from the catalog. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isLoading}
            >
              {deleteMutation.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {busy && <div className="sr-only">Processing...</div>}
    </div>
  );
}
