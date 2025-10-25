import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import {
  createAdminGiftCode,
  deleteAdminGiftCode,
  fetchAdminGiftCodes,
  updateAdminGiftCode,
} from "@/lib/api-client";
import type { GiftCode } from "@/lib/types";
import { Gift, Loader2, Pencil, PlusCircle, Power, Trash2 } from "lucide-react";
import { Slab } from "react-loading-indicators";

type GiftCodeFormState = {
  title: string;
  code: string;
  reward_amount: string;
  total_uses: string;
  is_active: boolean;
};

const emptyForm: GiftCodeFormState = {
  title: "",
  code: "",
  reward_amount: "0",
  total_uses: "1",
  is_active: true,
};

const parsePositiveInt = (value: string): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return Math.floor(parsed);
};

const parseNonNegativeInt = (value: string): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.round(parsed);
};

const giftStatus = (gift: GiftCode) =>
  gift.is_active ? (
    <Badge variant="default">Đang mở</Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Đã tắt
    </Badge>
  );

const giftQuota = (gift: GiftCode) =>
  `${gift.redeemed_count.toLocaleString()} / ${gift.total_uses.toLocaleString()}`;

export default function AdminGiftCodes() {
  const queryClient = useQueryClient();
  const [showInactive, setShowInactive] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<GiftCode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GiftCode | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<GiftCodeFormState>(emptyForm);
  const [editForm, setEditForm] = useState<GiftCodeFormState>(emptyForm);

  const giftcodesQuery = useQuery({
    queryKey: ["admin-giftcodes", showInactive ? "all" : "active"],
    queryFn: () => fetchAdminGiftCodes({ include_inactive: showInactive }),
    keepPreviousData: true,
  });

  const giftcodes = useMemo(
    () => giftcodesQuery.data ?? [],
    [giftcodesQuery.data],
  );

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
        title: editTarget.title ?? "",
        code: editTarget.code ?? "",
        reward_amount: String(editTarget.reward_amount ?? 0),
        total_uses: String(editTarget.total_uses ?? 1),
        is_active: Boolean(editTarget.is_active),
      });
    }
  }, [editOpen, editTarget]);

  const invalidateGiftcodes = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-giftcodes"] });
  };

  const createMutation = useMutation({
    mutationFn: async (form: GiftCodeFormState) => {
      const reward = parsePositiveInt(form.reward_amount);
      if (reward === null) {
        throw new Error("Số xu phải lớn hơn 0.");
      }
      const total = parsePositiveInt(form.total_uses);
      if (total === null) {
        throw new Error("Số lượng tổng phải lớn hơn 0.");
      }
      return createAdminGiftCode({
        title: form.title.trim(),
        code: form.code.trim(),
        reward_amount: reward,
        total_uses: total,
        is_active: form.is_active,
      });
    },
    onSuccess: () => {
      toast("Đã tạo mã quà.");
      invalidateGiftcodes();
      setCreateOpen(false);
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Không thể tạo mã quà.";
      setCreateError(message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      formState,
      original,
    }: {
      id: string;
      formState: GiftCodeFormState;
      original: GiftCode;
    }) => {
      const payload: Record<string, unknown> = {};
      if (formState.title.trim() !== (original.title ?? "")) {
        payload.title = formState.title.trim();
      }
      const normalizedCode = formState.code.trim();
      if (normalizedCode && normalizedCode !== original.code) {
        payload.code = normalizedCode;
      }
      const reward = parsePositiveInt(formState.reward_amount);
      if (reward === null) {
        throw new Error("Số xu phải lớn hơn 0.");
      }
      if (reward !== original.reward_amount) {
        payload.reward_amount = reward;
      }
      const total = parsePositiveInt(formState.total_uses);
      if (total === null) {
        throw new Error("Số lượng tổng phải lớn hơn 0.");
      }
      if (total !== original.total_uses) {
        payload.total_uses = total;
      }
      if (formState.is_active !== Boolean(original.is_active)) {
        payload.is_active = formState.is_active;
      }
      if (Object.keys(payload).length === 0) {
        return original;
      }
      return updateAdminGiftCode(id, payload);
    },
    onSuccess: () => {
      toast("Đã cập nhật mã quà.");
      invalidateGiftcodes();
      setEditOpen(false);
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Không thể cập nhật.";
      setEditError(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => deleteAdminGiftCode(id),
    onSuccess: () => {
      toast("Đã xóa mã quà.");
      invalidateGiftcodes();
      setDeleteTarget(null);
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Không thể xóa mã quà.";
      toast(message);
    },
    onSettled: () => setDeleteTarget(null),
  });

  const toggleMutation = useMutation({
    mutationFn: (gift: GiftCode) =>
      updateAdminGiftCode(gift.id, { is_active: !gift.is_active }),
    onSuccess: () => {
      invalidateGiftcodes();
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Không thể đổi trạng thái.";
      toast(message);
    },
  });

  const busy =
    giftcodesQuery.isLoading ||
    createMutation.isLoading ||
    updateMutation.isLoading ||
    deleteMutation.isLoading ||
    toggleMutation.isLoading;

  const handleCreateSubmit = () => {
    setCreateError(null);
    createMutation.mutate(createForm);
  };

  const handleEditSubmit = () => {
    if (!editTarget) return;
    setEditError(null);
    updateMutation.mutate({
      id: editTarget.id,
      formState: editForm,
      original: editTarget,
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
            <Gift className="h-6 w-6 text-primary" />
            Quản lý mã quà
          </h1>
          <p className="text-muted-foreground">
            Tạo và phân phối mã quà để thưởng xu cho người dùng.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
            <Switch
              checked={showInactive}
              onCheckedChange={(value) => setShowInactive(Boolean(value))}
              aria-label="Hiển thị mã đã tắt"
            />
            <span className="text-sm text-muted-foreground">
              Hiển thị mã đã tắt
            </span>
          </div>
          <Button className="gap-2" onClick={() => setCreateOpen(true)}>
            <PlusCircle className="h-4 w-4" />
            Tạo mã quà
          </Button>
        </div>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Danh sách mã quà</CardTitle>
          <CardDescription>
            Mỗi mã có tổng số lượt đổi áp dụng cho toàn bộ người dùng. Mỗi tài
            khoản chỉ đổi được một lần.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {giftcodesQuery.isLoading ? (
            <p className="py-12 text-center text-muted-foreground">
              <Slab color="#d18d00" size="large" text="Đang tải nội dung từ server" textColor="" />
            </p>
          ) : giftcodes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có mã quà nào.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tiêu đề</TableHead>
                  <TableHead>Mã quà</TableHead>
                  <TableHead className="w-24 text-right">Xu thưởng</TableHead>
                  <TableHead className="w-32 text-right">Đã đổi</TableHead>
                  <TableHead className="w-32">Trạng thái</TableHead>
                  <TableHead className="w-48">Cập nhật</TableHead>
                  <TableHead className="w-44 text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {giftcodes.map((gift) => (
                  <TableRow
                    key={gift.id}
                    className={!gift.is_active ? "opacity-70" : undefined}
                  >
                    <TableCell className="font-medium">
                      <div>{gift.title}</div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono tracking-wide">
                        {gift.code}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {gift.reward_amount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {giftQuota(gift)}
                    </TableCell>
                    <TableCell>{giftStatus(gift)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {gift.updated_at
                        ? formatDistanceToNow(new Date(gift.updated_at), {
                            addSuffix: true,
                          })
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditTarget(gift);
                            setEditOpen(true);
                          }}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Sửa
                        </Button>
                        <Button
                          variant={gift.is_active ? "destructive" : "secondary"}
                          size="sm"
                          onClick={() => toggleMutation.mutate(gift)}
                          disabled={toggleMutation.isLoading}
                        >
                          <Power className="mr-2 h-4 w-4" />
                          {gift.is_active ? "Tắt" : "Bật"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive border-destructive/40"
                          onClick={() => setDeleteTarget(gift)}
                          disabled={deleteMutation.isLoading}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Xóa
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
            <DialogTitle>Tạo mã quà mới</DialogTitle>
            <DialogDescription>
              Nhập mã và phần thưởng để người dùng đổi xu.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="create-title">Tiêu đề</Label>
              <Input
                id="create-title"
                value={createForm.title}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    title: event.target.value,
                  }))
                }
                placeholder="Ví dụ: Tân thủ nhận quà"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-code">Mã quà</Label>
              <Input
                id="create-code"
                value={createForm.code}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    code: event.target.value,
                  }))
                }
                placeholder="WELCOME2025"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-reward">Số xu thưởng</Label>
              <Input
                id="create-reward"
                type="number"
                min={1}
                value={createForm.reward_amount}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    reward_amount: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="create-total">Tổng số lượt đổi</Label>
              <Input
                id="create-total"
                type="number"
                min={1}
                value={createForm.total_uses}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    total_uses: event.target.value,
                  }))
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2">
              <div>
                <Label htmlFor="create-active" className="text-sm font-medium">
                  Kích hoạt
                </Label>
                <p className="text-xs text-muted-foreground">
                  Nếu tắt, mã sẽ không thể đổi.
                </p>
              </div>
              <Switch
                id="create-active"
                checked={createForm.is_active}
                onCheckedChange={(value) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    is_active: Boolean(value),
                  }))
                }
              />
            </div>
            {createError && (
              <p className="text-sm text-destructive">{createError}</p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={createMutation.isLoading}
            >
              Hủy
            </Button>
            <Button
              onClick={handleCreateSubmit}
              disabled={createMutation.isLoading}
            >
              {createMutation.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Tạo mã"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg glass-card">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa mã quà</DialogTitle>
            <DialogDescription>
              Cập nhật thông tin cho {editTarget?.title ?? "mã quà"}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="edit-title">Tiêu đề</Label>
              <Input
                id="edit-title"
                value={editForm.title}
                onChange={(event) =>
                  setEditForm((prev) => ({
                    ...prev,
                    title: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-code">Mã quà</Label>
              <Input
                id="edit-code"
                value={editForm.code}
                onChange={(event) =>
                  setEditForm((prev) => ({ ...prev, code: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-reward">Số xu thưởng</Label>
              <Input
                id="edit-reward"
                type="number"
                min={1}
                value={editForm.reward_amount}
                onChange={(event) =>
                  setEditForm((prev) => ({
                    ...prev,
                    reward_amount: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-total">Tổng số lượt đổi</Label>
              <Input
                id="edit-total"
                type="number"
                min={1}
                value={editForm.total_uses}
                onChange={(event) =>
                  setEditForm((prev) => ({
                    ...prev,
                    total_uses: event.target.value,
                  }))
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2">
              <div>
                <Label htmlFor="edit-active" className="text-sm font-medium">
                  Kích hoạt
                </Label>
                <p className="text-xs text-muted-foreground">
                  Tắt nếu muốn khóa mã.
                </p>
              </div>
              <Switch
                id="edit-active"
                checked={editForm.is_active}
                onCheckedChange={(value) =>
                  setEditForm((prev) => ({
                    ...prev,
                    is_active: Boolean(value),
                  }))
                }
              />
            </div>
            {editError && (
              <p className="text-sm text-destructive">{editError}</p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setEditOpen(false)}
              disabled={updateMutation.isLoading}
            >
              Hủy
            </Button>
            <Button
              onClick={handleEditSubmit}
              disabled={updateMutation.isLoading || !editTarget}
            >
              {updateMutation.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Lưu thay đổi"
              )}
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
            <AlertDialogTitle>Xóa mã quà</AlertDialogTitle>
            <AlertDialogDescription>
              Xóa vĩnh viễn {deleteTarget?.title ?? "mã quà"} khỏi hệ thống.
              Thao tác không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isLoading}>
              Hủy
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget.id)
              }
              disabled={deleteMutation.isLoading}
            >
              {deleteMutation.isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Xóa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {busy && <div className="sr-only">Đang xử lý...</div>}
    </div>
  );
}
