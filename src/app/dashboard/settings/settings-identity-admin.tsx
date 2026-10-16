"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/infrastructure/auth/auth-client";
import type { FmccRole } from "@/domain/security/permissions";
import { useTranslator } from "@/i18n/react/i18n-provider";
import { createLabels } from "@/presentation/labels";

type MemberView = {
  readonly id: string;
  readonly userId: string;
  readonly role: FmccRole;
  readonly name: string;
  readonly email: string;
};

const ASSIGNABLE_ROLES: readonly Exclude<FmccRole, "owner">[] = [
  "admin",
  "analyst",
  "viewer",
  "member",
];

export function SettingsIdentityAdmin({
  organization,
  members,
  currentUserId,
  canManageTenant,
  canManageMembers,
}: {
  organization: { readonly id: string; readonly name: string; readonly slug: string };
  members: readonly MemberView[];
  currentUserId: string;
  canManageTenant: boolean;
  canManageMembers: boolean;
}) {
  const router = useRouter();
  const { t, locale } = useTranslator();
  const labels = createLabels(locale);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function updateOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageTenant) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    if (name.length < 2 || name.length > 120) {
      setMessage(t("settings.admin.nameInvalid"));
      return;
    }

    setBusy("organization");
    setMessage("");
    try {
      const result = await authClient.organization.update({
        organizationId: organization.id,
        data: { name },
      });
      if (result.error) {
        setMessage(t("settings.admin.orgFailed"));
        return;
      }
      setMessage(t("settings.admin.orgDone"));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageMembers) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim().toLowerCase();
    const role = String(data.get("role") ?? "member") as Exclude<FmccRole, "owner">;
    if (!email || !ASSIGNABLE_ROLES.includes(role)) {
      setMessage(t("settings.admin.inviteInvalid"));
      return;
    }

    setBusy("invite");
    setMessage("");
    try {
      const result = await authClient.organization.inviteMember({
        email,
        role,
        organizationId: organization.id,
      });
      if (result.error) {
        setMessage(t("settings.admin.inviteFailed"));
        return;
      }
      setMessage(t("settings.admin.inviteDone"));
      event.currentTarget.reset();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function updateRole(memberId: string, role: Exclude<FmccRole, "owner">) {
    if (!canManageMembers || !ASSIGNABLE_ROLES.includes(role)) return;
    setBusy(`role:${memberId}`);
    setMessage("");
    try {
      const result = await authClient.organization.updateMemberRole({
        memberId,
        role,
        organizationId: organization.id,
      });
      if (result.error) {
        setMessage(t("settings.admin.roleFailed"));
        return;
      }
      setMessage(t("settings.admin.roleDone"));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(member: MemberView) {
    if (!canManageMembers || member.userId === currentUserId || member.role === "owner") return;
    setBusy(`remove:${member.id}`);
    setMessage("");
    try {
      const result = await authClient.organization.removeMember({
        memberIdOrEmail: member.id,
        organizationId: organization.id,
      });
      if (result.error) {
        setMessage(t("settings.admin.removeFailed"));
        return;
      }
      setMessage(t("settings.admin.removeDone"));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="executive-section" aria-labelledby="identity-settings-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{t("settings.admin.eyebrow")}</span>
          <h2 id="identity-settings-title">{t("settings.admin.title")}</h2>
        </div>
        <p>{t("settings.admin.note")}</p>
      </div>

      <div className="settings-governance-grid">
        <section className="panel">
          <h3>{t("settings.org")}</h3>
          <p><strong>{organization.name}</strong> · <code>{organization.slug}</code></p>
          {canManageTenant ? (
            <form onSubmit={updateOrganization}>
              <label htmlFor="settings-org-name">{t("settings.admin.orgName")}</label>
              <input
                id="settings-org-name"
                name="name"
                defaultValue={organization.name}
                minLength={2}
                maxLength={120}
                required
              />
              <button className="button" type="submit" disabled={busy !== null}>
                {busy === "organization" ? t("settings.admin.saving") : t("settings.admin.saveName")}
              </button>
            </form>
          ) : (
            <p>{t("settings.admin.ownerOnly")}</p>
          )}
        </section>

        <section className="panel">
          <h3>{t("settings.admin.invite")}</h3>
          {canManageMembers ? (
            <form onSubmit={inviteMember}>
              <label htmlFor="settings-invite-email">{t("settings.admin.email")}</label>
              <input id="settings-invite-email" name="email" type="email" required />
              <label htmlFor="settings-invite-role">{t("settings.admin.role")}</label>
              <select id="settings-invite-role" name="role" defaultValue="member">
                {ASSIGNABLE_ROLES.map((role) => (
                  <option value={role} key={role}>{labels.role(role)}</option>
                ))}
              </select>
              <button className="button" type="submit" disabled={busy !== null}>
                {busy === "invite" ? t("settings.admin.registering") : t("settings.admin.inviteButton")}
              </button>
            </form>
          ) : (
            <p>{t("settings.admin.cannotManage")}</p>
          )}
        </section>
      </div>

      <section className="panel">
        <h3>{t("settings.admin.members")}</h3>
        <div className="settings-member-list">
          {members.map((member) => (
            <article className="settings-member-row" key={member.id}>
              <div>
                <strong>{member.name}</strong>
                <span>{member.email}</span>
              </div>
              <div>
                {canManageMembers && member.role !== "owner" ? (
                  <select
                    aria-label={t("settings.admin.roleOf", { name: member.name })}
                    value={member.role}
                    disabled={busy !== null}
                    onChange={(event) =>
                      updateRole(
                        member.id,
                        event.currentTarget.value as Exclude<FmccRole, "owner">,
                      )
                    }
                  >
                    {ASSIGNABLE_ROLES.map((role) => (
                      <option value={role} key={role}>{labels.role(role)}</option>
                    ))}
                  </select>
                ) : (
                  <span>{labels.role(member.role)}</span>
                )}
                {canManageMembers &&
                member.userId !== currentUserId &&
                member.role !== "owner" ? (
                  <button
                    className="button"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => removeMember(member)}
                  >
                    {busy === `remove:${member.id}` ? t("settings.admin.removing") : t("settings.admin.remove")}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>

      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
