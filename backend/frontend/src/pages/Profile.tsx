import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/context/AuthContext";
import { updateProfile } from "@/lib/api-client";
import type { UserProfile } from "@/lib/types";
import { toast } from "@/components/ui/sonner";

const MAX_DISPLAY_NAME = 100;
const MAX_PHONE = 50;

const sanitize = (value: string) => value.trim();

const Profile = () => {
  const { profile, refresh } = useAuth();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");

  useEffect(() => {
    setDisplayName(profile?.display_name ?? "");
    setPhoneNumber(profile?.phone_number ?? "");
  }, [profile?.display_name, profile?.phone_number]);

  const mutation = useMutation({
    mutationFn: (payload: { display_name: string | null; phone_number: string | null }) => updateProfile(payload),
    onSuccess: (data: UserProfile) => {
      queryClient.setQueryData(["profile"], data);
      refresh();
      toast("Đã cập nhật hồ sơ.");
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Cập nhật hồ sơ thất bại.";
      toast(message);
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile) return;
    const payload = {
      display_name: sanitize(displayName) || null,
      phone_number: sanitize(phoneNumber) || null,
    };
    mutation.mutate(payload);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Hồ sơ của tôi</h1>
        <p className="text-muted-foreground">
          Cập nhật thông tin hiển thị. Email và tên đăng nhập do hệ thống xác thực quản lý, không thể thay đổi tại đây.
        </p>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Thông tin tài khoản</CardTitle>
          <CardDescription>Những mục bên dưới chỉ để xem nhanh.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>Email</Label>
            <Input value={profile?.email ?? "Chưa cung cấp"} readOnly disabled />
          </div>
          <div className="grid gap-2">
            <Label>Tên đăng nhập</Label>
            <Input value={profile?.username ?? "Không rõ"} readOnly disabled />
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Cá nhân hóa</CardTitle>
          <CardDescription>Chọn cách bạn xuất hiện và cách chúng tôi liên hệ với bạn.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid gap-2">
              <Label htmlFor="display-name">Tên hiển thị</Label>
              <Input
                id="display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value.slice(0, MAX_DISPLAY_NAME))}
                placeholder="Tên công khai của bạn"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="phone-number">Số điện thoại</Label>
              <Input
                id="phone-number"
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value.slice(0, MAX_PHONE))}
                placeholder="Số liên hệ (không bắt buộc)"
              />
            </div>

            <Separator />

            <div className="flex items-center justify-end gap-2">
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Đang lưu…" : "Lưu thay đổi"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Profile;
