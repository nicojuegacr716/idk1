import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  fetchAdsSettings,
  fetchKyaroPrompt,
  updateKyaroPrompt,
} from "@/lib/api-client";
import type { AdsSettings, KyaroPrompt } from "@/lib/types";
import { toast } from "@/components/ui/sonner";

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

  const [draftPrompt, setDraftPrompt] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (kyaro?.prompt !== undefined && !touched) {
      setDraftPrompt(kyaro.prompt);
    }
  }, [kyaro?.prompt, touched]);

  const updatePromptMutation = useMutation({
    mutationFn: updateKyaroPrompt,
    onSuccess: (data) => {
      toast("Kyaro prompt updated.");
      queryClient.setQueryData(["admin-settings", "kyaro"], data);
      setTouched(false);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to update Kyaro prompt.";
      toast(message);
    },
  });
  const promptChanged = useMemo(() => draftPrompt !== (kyaro?.prompt ?? ""), [draftPrompt, kyaro?.prompt]);
  const promptValid = draftPrompt.trim().length > 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">System Settings</h1>
        <p className="text-muted-foreground">
          Manage platform behaviour through <code className="font-mono text-xs">/api/v1/admin/settings</code>.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Ads Rewards</CardTitle>
            <CardDescription>Toggle indicates whether ads-based coin rewards are enabled.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Ads rewards enabled</p>
              <p className="text-xs text-muted-foreground">
                Value returned from <code className="font-mono text-[10px]">/settings/ads</code>.
              </p>
            </div>
            <Switch checked={Boolean(ads?.enabled)} disabled aria-readonly />
          </CardContent>
        </Card>

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
                setTouched(true);
              }}
              className="h-48 glass-card"
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
                  setTouched(false);
                }}
                disabled={!promptChanged || updatePromptMutation.isLoading}
              >
                Reset
              </Button>
              <Button
                onClick={() => updatePromptMutation.mutate(draftPrompt.trim())}
                disabled={!promptChanged || !promptValid || updatePromptMutation.isLoading}
              >
                {updatePromptMutation.isLoading ? "Saving..." : "Save Prompt"}
              </Button>
            </div>
            {!promptValid && <p className="text-xs text-destructive">Prompt cannot be empty.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
