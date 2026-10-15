export type NotificationKind =
  | "critical_alert"
  | "operational_warning"
  | "integration_failure"
  | "incident"
  | "action_required"
  | "state_change"
  | "system_info";

export interface NotificationCandidate {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly description: string;
  readonly createdAt: Date;
  readonly sourceEvent: string;
  readonly sourceAuthority: string;
  readonly href: string;
  readonly productId?: string;
  readonly severity?: string;
  readonly acknowledged?: boolean;
}

export interface NotificationItem {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly description: string;
  readonly createdAt: string;
  readonly sourceEvent: string;
  readonly sourceAuthority: string;
  readonly href: string;
  readonly productId?: string;
  readonly severity?: string;
  readonly read: boolean;
  readonly acknowledged?: boolean;
}

export interface NotificationInbox {
  readonly items: readonly NotificationItem[];
  readonly unreadCount: number;
  readonly totalCount: number;
  readonly dataBoundary: string;
}

export interface NotificationStateRepository {
  readIds(
    tenantId: string,
    userId: string,
    notificationIds: readonly string[],
  ): Promise<ReadonlySet<string>>;

  markRead(input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly notificationId: string;
    readonly correlationId: string;
  }): Promise<{ readonly created: boolean; readonly readAt: Date }>;

  listUserActionEvents(
    tenantId: string,
    userId: string,
    limit: number,
  ): Promise<readonly NotificationCandidate[]>;
}

export class NotificationQueryError extends Error {
  constructor(message = "notification.query_invalid") {
    super(message);
    this.name = "NotificationQueryError";
  }
}

export class NotificationNotFoundError extends Error {
  constructor() {
    super("notification.not_found");
    this.name = "NotificationNotFoundError";
  }
}
