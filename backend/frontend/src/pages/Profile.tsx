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
      toast("Profile updated.");
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to update profile.";
      toast(message);
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile) {
      return;
    }
    const payload = {
      display_name: sanitize(displayName) || null,
      phone_number: sanitize(phoneNumber) || null,
    };
    mutation.mutate(payload);
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">My Profile</h1>
        <p className="text-muted-foreground">
          Update your display information. Email and username are managed by the authentication system and cannot be changed here.
        </p>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Account Details</CardTitle>
          <CardDescription>Review the information associated with your account.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label>Email</Label>
            <Input value={profile?.email ?? "Not provided"} readOnly disabled />
          </div>
          <div className="grid gap-2">
            <Label>Username</Label>
            <Input value={profile?.username ?? "Unknown"} readOnly disabled />
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Personalise</CardTitle>
          <CardDescription>Choose how other users will see you and how we can contact you.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid gap-2">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                id="display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value.slice(0, MAX_DISPLAY_NAME))}
                placeholder="Your public name"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="phone-number">Phone number</Label>
              <Input
                id="phone-number"
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value.slice(0, MAX_PHONE))}
                placeholder="Optional contact number"
              />
            </div>

            <Separator />

            <div className="flex items-center justify-end gap-2">
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Profile;

