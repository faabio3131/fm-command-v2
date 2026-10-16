"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/infrastructure/auth/auth-client";
import type { FmccRole } from "@/domain/security/permissions";
import { rotuloPapelFmcc } from "@/presentation/pt-br";

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
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function updateOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageTenant) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    if (name.length < 2 || name.length > 120) {
      setMessage("Informe um nome de organização válido.");
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
        setMessage("Não foi possível atualizar a organização.");
        return;
      }
      setMessage("Organização atualizada.");
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
      setMessage("Convite inválido.");
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
        setMessage("Não foi possível criar o convite.");
        return;
      }
      setMessage("Convite registrado pela autoridade de autenticação.");
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
        setMessage("Não foi possível alterar o papel.");
        return;
      }
      setMessage("Papel atualizado.");
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
        setMessage("Não foi possível remover o membro.");
        return;
      }
      setMessage("Membro removido.");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="executive-section" aria-labelledby="identity-settings-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Autoridade Better Auth</span>
          <h2 id="identity-settings-title">Organização, usuários e papéis</h2>
        </div>
        <p>
          Alterações usam a autoridade de autenticação existente; o FM Command
          não mantém uma segunda fonte de verdade para membros ou papéis.
        </p>
      </div>

      <div className="settings-governance-grid">
        <section className="panel">
          <h3>Organização</h3>
          <p><strong>{organization.name}</strong> · <code>{organization.slug}</code></p>
          {canManageTenant ? (
            <form onSubmit={updateOrganization}>
              <label htmlFor="settings-org-name">Nome da organização</label>
              <input
                id="settings-org-name"
                name="name"
                defaultValue={organization.name}
                minLength={2}
                maxLength={120}
                required
              />
              <button className="button" type="submit" disabled={busy !== null}>
                {busy === "organization" ? "Salvando…" : "Salvar nome"}
              </button>
            </form>
          ) : (
            <p>Somente o proprietário pode alterar dados da organização.</p>
          )}
        </section>

        <section className="panel">
          <h3>Convidar membro</h3>
          {canManageMembers ? (
            <form onSubmit={inviteMember}>
              <label htmlFor="settings-invite-email">E-mail</label>
              <input id="settings-invite-email" name="email" type="email" required />
              <label htmlFor="settings-invite-role">Papel</label>
              <select id="settings-invite-role" name="role" defaultValue="member">
                {ASSIGNABLE_ROLES.map((role) => (
                  <option value={role} key={role}>{rotuloPapelFmcc(role)}</option>
                ))}
              </select>
              <button className="button" type="submit" disabled={busy !== null}>
                {busy === "invite" ? "Registrando…" : "Convidar"}
              </button>
            </form>
          ) : (
            <p>Seu papel atual não pode administrar membros.</p>
          )}
        </section>
      </div>

      <section className="panel">
        <h3>Membros atuais</h3>
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
                    aria-label={`Papel de ${member.name}`}
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
                      <option value={role} key={role}>{rotuloPapelFmcc(role)}</option>
                    ))}
                  </select>
                ) : (
                  <span>{rotuloPapelFmcc(member.role)}</span>
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
                    {busy === `remove:${member.id}` ? "Removendo…" : "Remover"}
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
