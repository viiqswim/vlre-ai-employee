export interface HostfullyWebhookPayload {
  agency_uid: string;
  event_type: string;
  message_uid: string;
  thread_uid: string;
  lead_uid?: string;
  property_uid?: string;
  message_content?: string;
  created?: string;
  type?: string;
  status?: string;
}

export interface HostfullyAttachment {
  uid?: string;
  fileName?: string;
  fileUrl?: string;
  fileType?: string;
}

export interface HostfullyMessage {
  uid: string;
  threadUid: string;
  leadUid: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  senderType?: 'GUEST' | 'PROPERTY_MANAGER' | 'SYSTEM' | string;
  senderName?: string;
  isRead?: boolean;
  messageType?: string;
  attachments?: HostfullyAttachment[];
}

export interface HostfullyThread {
  uid: string;
  leadUid?: string;
  propertyUid?: string;
  agencyUid?: string;
  status?: 'OPEN' | 'CLOSED' | string;
  lastMessageAt?: string;
  messages?: HostfullyMessage[];
  guestName?: string;
  guestEmail?: string;
  channel?: string;
  createdAt?: string;
  updatedAt?: string;
  participants?: Array<{
    participantType: 'AGENCY' | 'LEAD' | string;
    participantUid: string;
    uid: string;
  }>;
}

export interface HostfullyLead {
  uid: string;
  propertyUid: string;
  guestFirstName?: string;
  guestLastName?: string;
  guestEmail?: string;
  guestPhoneNumber?: string;
  checkInDate?: string;
  checkOutDate?: string;
  checkInTime?: number;
  checkOutTime?: number;
  numberOfGuests?: number;
  numberOfNights?: number;
  channel?: string;
  status?: 'NEW' | 'ACCEPTED' | 'CANCELLED' | 'EXPIRED' | string;
  totalPrice?: number;
  currency?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  agencyUid?: string;
  threadUid?: string;
}

export interface HostfullyProperty {
  uid: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  zipCode?: string;
  description?: string;
  numberOfBedrooms?: number;
  numberOfBathrooms?: number;
  maxGuests?: number;
  checkInTime?: number;
  checkOutTime?: number;
  agencyUid?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  amenities?: string[];
  thumbnail?: string;
}

export interface HostfullySendMessageRequest {
  type: 'EMAIL' | 'DIRECT_MESSAGE';
  threadUid?: string;
  leadUid?: string;
  content: {
    subject?: string | null;
    text: string;
  };
}

export interface HostfullySendMessageResponse {
  uid: string;
  threadUid: string;
  content: string;
  createdAt: string;
  senderType?: string;
}

export interface HostfullyMessagesListResponse {
  messages: HostfullyMessage[];
  _metadata?: {
    count: number;
    totalCount: number | null;
  };
}

export interface HostfullyWebhookRegistrationRequest {
  agencyUid: string;
  eventType: 'NEW_INBOX_MESSAGE' | string;
  callbackUrl: string;
  webhookType?: 'POST_JSON' | string;
  objectUid?: string;
}

export interface HostfullyWebhookRegistrationResponse {
  uid: string;
  agencyUid: string;
  webhookType?: string;
  eventType: string;
  callbackUrl: string;
  createdAt?: string;
  status?: string;
  objectUid?: string;
  creatorIdentifier?: string;
}

export interface HostfullyApiError {
  error?: string;
  message?: string;
  status?: number;
  details?: unknown;
}

export interface HostfullyClientConfig {
  apiKey: string;
  agencyUid: string;
  baseUrl: string;
}
