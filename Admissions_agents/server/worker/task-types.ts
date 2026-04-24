export type PublishPayload = {
  title: string;
  content: string;
  tags?: string[];
  imageDescs?: string[];
};

export type FetchDmPayload = {
  since?: string;
  limit?: number;
};

export type AccountLoginPayload = {
  expireAt?: string;
};

export type PublishResult = {
  success: boolean;
  platformPostId?: string;
  message?: string;
  screenshotPath?: string;
};

export type FetchDmResult = {
  success: boolean;
  fetched: number;
  leadCreated: number;
  message?: string;
};

export type AccountContext = {
  id: number;
  platform: 'xiaohongshu' | 'douyin' | 'kuaishou';
  nickname: string;
  deviceFingerprint: string | null;
  cookiesJson: string | null;
};

export type FetchedDm = {
  platformMsgId: string;
  senderNickname: string;
  content: string;
  msgType: 'dm' | 'comment';
  fetchedAt: string;
};
