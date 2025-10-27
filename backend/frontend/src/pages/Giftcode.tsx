import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Gift } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { redeemGiftCode, ApiError } from "@/lib/api-client";
import { useTurnstile } from "@/hooks/useTurnstile";

type GiftResult = {
  title: string;
  added: number;
  balance: number;
  remaining: number;
};

const Giftcode = () => {
  const queryClient = useQueryClient();
  const [giftCodeInput, setGiftCodeInput] = useState("");
  const [giftMessage, setGiftMessage] = useState<string | null>(null);
  const [giftResult, setGiftResult] = useState<GiftResult | null>(null);
  const giftTurnstile = useTurnstile("giftcode_redeem");

  const redeemMutation = useMutation({
    mutationFn: redeemGiftCode,
    onSuccess: (data) => {
      setGiftResult({
        title: data.gift_title,
        added: data.added,
        balance: data.balance,
        remaining: data.remaining,
      });
      setGiftMessage(
        `Đổi mã thành công ${data.gift_title}. Bạn nhận được ${data.added.toLocaleString()} xu, số dư hiện tại: ${data.balance.toLocaleString()} xu.`,
      );
      setGiftCodeInput("");
      queryClient.invalidateQueries({ queryKey: ["wallet-balance"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => {
      let detail = "Khong the doi ma. Vui long kiem tra va thu lai.";
      if (error instanceof ApiError) {
        const raw = (error.data as { detail?: string } | undefined)?.detail;
        if (typeof raw === "string") {
          detail = raw;
        }
      } else if (error instanceof Error) {
        detail = error.message;
      }
      setGiftResult(null);
      setGiftMessage(detail);
      toast(detail);
    },
    onSettled: () => {
      giftTurnstile.reset();
    },
  });

  const handleRedeem = () => {
    const trimmed = giftCodeInput.trim().toUpperCase();
    if (!trimmed) {
      setGiftResult(null);
      setGiftMessage("Vui lòng nhập mã quà hợp lệ.");
      return;
    }
    if (giftTurnstile.configured) {
      if (giftTurnstile.error) {
        toast(giftTurnstile.error);
        return;
      }
      if (!giftTurnstile.token) {
        toast("Vui lòng hoàn thành captcha trước khi đổi mã.");
        return;
      }
    }
    setGiftMessage(null);
    redeemMutation.mutate({ code: trimmed, turnstileToken: giftTurnstile.token ?? undefined });
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Giftcode</CardTitle>
          <CardDescription>
            Nhập mã quà tặng để nhận xu vào ví của bạn. <strong>MỖI TÀI KHOẢN CHỈ ĐƯỢC ĐỔI MỘT LẦN!</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              placeholder="Nhập mã giftcode"
              value={giftCodeInput}
              onChange={(event) => setGiftCodeInput(event.target.value)}
              className="sm:flex-1"
            />
            <Button
              onClick={handleRedeem}
              disabled={
                redeemMutation.isLoading ||
                (giftTurnstile.configured &&
                  (!giftTurnstile.token || Boolean(giftTurnstile.error) || !giftTurnstile.ready))
              }
              className="gap-2"
            >
              {redeemMutation.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Gift className="h-4 w-4" />
              )}
              Đổi mã
            </Button>
          </div>
          {giftResult && (
            <p className="text-xs text-muted-foreground">
              Mã {giftResult.title} còn lại{" "}
              {giftResult.remaining.toLocaleString()} lượt.
            </p>
          )}
          {giftMessage && (
            <p
              className={cn(
                "text-sm",
                giftResult ? "text-emerald-600" : "text-destructive",
              )}
            >
              {giftMessage}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Giftcode;

          <div className="space-y-2">
            <div ref={giftTurnstile.containerRef} className="flex justify-center" />
            {giftTurnstile.error && (
              <p className="text-xs text-destructive text-center">{giftTurnstile.error}</p>
            )}
            {giftTurnstile.configured && !giftTurnstile.error && !giftTurnstile.ready && (
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Đang tải captcha...
              </p>
            )}
          </div>
