import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import {
  fetchAdsSettings,
  fetchAdminVersionInfo,
  fetchKyaroPrompt,
  updateAdminVersionInfo,
  updateKyaroPrompt,
  uploadAdminAsset,
} from "@/lib/api-client";
import type {
  AdsSettings,
  AssetUploadResponse,
  KyaroPrompt,
  VersionChannel,
  VersionInfo,
} from "@/lib/types";

const VERSION_OPTIONS: Array<{
  value: VersionChannel;
  label: string;
  description: string;
}> = [
  {
    value: "devStable",
    label: "devStable",
    description: "Phiên bản ổn định đã được kiểm thử nhưng vẫn đang phát triển.",
  },
  {
    value: "stable",
    label: "Stable",
    description: "Phiên bản ổn định đã được kiểm thử đầy đủ.",
  },
  {
    value: "dev",
    label: "dev",
    description: "Phiên bản phát hành sớm, chưa được kiểm thử ổn định.",
  },
  {
    value: "devBack",
    label: "devBack",
    description: "Phiên bản cũ được khởi động lại do bản mới đang lỗi.",
  },
];

export default function Settings() {
  const queryClient = useQueryClient();

  const { data: ads } = useQuery<AdsSettings>({
    queryKey: ["admin-settings", "ads"],
    queryFn: fetchAdsSettings,
    staleTime: 60_000,
  });

  const { data: kyaro } = useQuery<KyaroPrompt>({
    queryKey: ["admin-settings", "kyaro"],
    queryFn: fetchKyaroPrompt,
    staleTime: 60_000,
  });

  const { data: versionInfo } = useQuery<VersionInfo>({
    queryKey: ["admin-settings", "version"],
    queryFn: fetchAdminVersionInfo,
    staleTime: 60_000,
  });

  const [draftPrompt, setDraftPrompt] = useState("");
  const [promptTouched, setPromptTouched] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedAsset, setUploadedAsset] = useState<AssetUploadResponse | null>(null);
  const [versionChannel, setVersionChannel] = useState<VersionChannel>("dev");
  const [versionCode, setVersionCode] = useState("");

  useEffect(() => {
    if (kyaro?.prompt !== undefined && !promptTouched) {
      setDraftPrompt(kyaro.prompt);
    }
  }, [kyaro?.prompt, promptTouched]);

  useEffect(() => {
    if (versionInfo) {
      setVersionChannel(versionInfo.channel as VersionChannel);
      setVersionCode(versionInfo.version ?? "");
    }
  }, [versionInfo?.channel, versionInfo?.version]);

  const updatePromptMutation = useMutation({
    mutationFn: updateKyaroPrompt,
    onSuccess: (data) => {
      toast("Kyaro prompt updated.");
      queryClient.setQueryData(["admin-settings", "kyaro"], data);
      setPromptTouched(false);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to update Kyaro prompt.";
      toast(message);
    },
  });

  const promptChanged = useMemo(
    () => draftPrompt !== (kyaro?.prompt ?? ""),
    [draftPrompt, kyaro?.prompt],
  );
  const promptValid = draftPrompt.trim().length > 0;

  const uploadMutation = useMutation({
    mutationFn: uploadAdminAsset,
    onSuccess: (data) => {
      setUploadedAsset(data);
      toast("Asset uploaded successfully.");
      setSelectedFile(null);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to upload asset.";
      toast(message);
    },
  });

  const updateVersionMutation = useMutation({
    mutationFn: updateAdminVersionInfo,
    onSuccess: (data) => {
      toast("Platform version updated.");
      queryClient.setQueryData(["admin-settings", "version"], data);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to update platform version.";
      toast(message);
    },
  });

  const versionChanged = useMemo(() => {
    if (!versionInfo) return false;
    return (
      versionChannel !== (versionInfo.channel as VersionChannel) ||
      versionCode.trim() !== (versionInfo.version ?? "")
    );
  }, [versionChannel, versionCode, versionInfo]);

  const currentVersionOption = useMemo(() => {
    return VERSION_OPTIONS.find((option) => option.value === versionChannel);
  }, [versionChannel]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 text-3xl font-bold">System Settings</h1>
        <p className="text-muted-foreground">
          Manage platform behaviour through{" "}
          <code className="font-mono text-xs">/api/v1/admin/settings</code>.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Ads Rewards</CardTitle>
            <CardDescription>
              Toggle indicates whether ads-based coin rewards are enabled.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Ads rewards enabled</p>
              <p className="text-xs text-muted-foreground">
                Value returned from{" "}
                <code className="font-mono text-[10px]">/settings/ads</code>.
              </p>
            </div>
            <Switch checked={Boolean(ads?.enabled)} disabled aria-readonly />
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Platform version</CardTitle>
            <CardDescription>
              Decide which release channel is shown in the footer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {versionInfo && (
              <div className="text-xs text-muted-foreground">
                <p>
                  Hiện tại: <span className="font-medium">{versionInfo.channel}</span>{" "}
                  {versionInfo.version}
                </p>
                {versionInfo.updated_at && (
                  <p>
                    Cập nhật {formatDistanceToNow(new Date(versionInfo.updated_at), { addSuffix: true })}
                  </p>
                )}
              </div>
            )}

            <RadioGroup
              value={versionChannel}
              onValueChange={(value) => setVersionChannel(value as VersionChannel)}
              className="grid gap-3"
            >
              {VERSION_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 p-3 transition hover:border-border"
                >
                  <RadioGroupItem className="mt-1" value={option.value} />
                  <div>
                    <p className="text-sm font-semibold">{option.label}</p>
                    <p className="text-xs text-muted-foreground">{option.description}</p>
                  </div>
                </label>
              ))}
            </RadioGroup>

            <div className="space-y-2">
              <Input
                value={versionCode}
                onChange={(event) => setVersionCode(event.target.value)}
                placeholder="v1.2.69"
              />
              <p className="text-xs text-muted-foreground">
                Chuỗi này sẽ được hiển thị kèm theo tên kênh phát hành.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  if (!versionInfo) return;
                  setVersionChannel(versionInfo.channel as VersionChannel);
                  setVersionCode(versionInfo.version ?? "");
                }}
                disabled={!versionChanged || updateVersionMutation.isLoading}
              >
                Reset
              </Button>
              <Button
                onClick={() =>
                  updateVersionMutation.mutate({
                    channel: versionChannel,
                    version: versionCode.trim(),
                  })
                }
                disabled={
                  !versionChanged ||
                  versionCode.trim().length === 0 ||
                  updateVersionMutation.isLoading
                }
              >
                {updateVersionMutation.isLoading ? "Saving..." : "Save"}
              </Button>
            </div>

            {currentVersionOption && (
              <p className="text-xs text-muted-foreground">
                Mo ta: {currentVersionOption.description}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Kyaro AI Prompt</CardTitle>
            <CardDescription>System prompt served to the Kyaro assistant.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={draftPrompt}
              onChange={(event) => {
                setDraftPrompt(event.target.value);
                setPromptTouched(true);
              }}
              className="glass-card h-48"
              placeholder="Describe how Kyaro should respond to admins and users..."
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Version: {kyaro?.version ?? "--"}</span>
              <span>Updated at: {kyaro?.updated_at ?? "--"}</span>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setDraftPrompt(kyaro?.prompt ?? "");
                  setPromptTouched(false);
                }}
                disabled={!promptChanged || updatePromptMutation.isLoading}
              >
                Reset
              </Button>
              <Button
                onClick={() => updatePromptMutation.mutate(draftPrompt.trim())}
                disabled={
                  !promptChanged || !promptValid || updatePromptMutation.isLoading
                }
              >
                {updatePromptMutation.isLoading ? "Saving..." : "Save Prompt"}
              </Button>
            </div>
            {!promptValid && (
              <p className="text-xs text-destructive">Prompt cannot be empty.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Upload Asset</CardTitle>
            <CardDescription>
              Images are stored under <code className="font-mono text-xs">/assets/&lt;code&gt;</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setSelectedFile(file);
              }}
            />
            <div className="flex justify-end">
              <Button
                onClick={() => selectedFile && uploadMutation.mutate(selectedFile)}
                disabled={!selectedFile || uploadMutation.isLoading}
              >
                {uploadMutation.isLoading ? "Uploading..." : "Upload"}
              </Button>
            </div>
            {uploadedAsset && (
              <div className="text-sm">
                <p className="font-medium">Uploaded:</p>
                <p className="break-all">{uploadedAsset.url}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  MIME: {uploadedAsset.content_type} | Code: {uploadedAsset.code}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
