export type WechatWorkConfig = {
  corpId: string;
  agentId: string;
  appSecret: string;
  contactSecret?: string;
};

type AccessTokenCache = {
  token: string;
  expiresAt: number;
};

const tokenCache = new Map<string, AccessTokenCache>();

export const getWechatWorkConfig = (): WechatWorkConfig | null => {
  const corpId = process.env.WECHAT_WORK_CORP_ID;
  const agentId = process.env.WECHAT_WORK_AGENT_ID;
  const appSecret = process.env.WECHAT_WORK_APP_SECRET;
  const contactSecret = process.env.WECHAT_WORK_CONTACT_SECRET;

  if (!corpId || !agentId || !appSecret) {
    return null;
  }

  return { corpId, agentId, appSecret, contactSecret };
};

const fetchAccessToken = async (corpId: string, secret: string, cacheKey: string): Promise<string | null> => {
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60 * 1000) {
    return cached.token;
  }

  try {
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`;
    const response = await fetch(url);
    const data = (await response.json()) as { access_token?: string; expires_in?: number; errmsg?: string; errcode?: number };

    if (!data.access_token) {
      console.error('[wechat-work] gettoken 失败', data);
      return null;
    }

    tokenCache.set(cacheKey, {
      token: data.access_token,
      expiresAt: Date.now() + ((data.expires_in ?? 7200) - 300) * 1000,
    });

    return data.access_token;
  } catch (error) {
    console.error('[wechat-work] gettoken 异常', error);
    return null;
  }
};

export type SendTextMessageInput = {
  toUser: string;
  content: string;
};

export type SendMessageResult = {
  success: boolean;
  stub?: boolean;
  error?: string;
};

export const sendTextMessageToUser = async (input: SendTextMessageInput): Promise<SendMessageResult> => {
  const config = getWechatWorkConfig();
  if (!config) {
    return { success: true, stub: true };
  }

  const token = await fetchAccessToken(config.corpId, config.appSecret, `app:${config.corpId}:${config.agentId}`);
  if (!token) {
    return { success: false, error: '获取企业微信 access_token 失败' };
  }

  try {
    const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: input.toUser,
        msgtype: 'text',
        agentid: Number(config.agentId),
        text: { content: input.content },
        safe: 0,
      }),
    });

    const data = (await response.json()) as { errcode?: number; errmsg?: string };
    if (data.errcode !== 0) {
      return { success: false, error: data.errmsg || `errcode=${data.errcode}` };
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `发送企业微信消息异常：${message}` };
  }
};

export type ExternalMessagePayload = {
  corpId: string;
  toUserName: string;
  fromUserName: string;
  createTime: number;
  msgType: string;
  content?: string;
  msgId?: string;
};

// ========= 外部联系人（客户联系）API =========

export type ExternalContact = {
  external_userid: string;
  name: string;
  type: 1 | 2; // 1 微信用户；2 企业微信用户
  avatar?: string;
  gender?: number;
  unionid?: string;
  position?: string;
  corp_name?: string;
  corp_full_name?: string;
};

export type FollowUser = {
  userid: string;
  remark?: string;
  description?: string;
  createtime?: number;
  add_way?: number;
  oper_userid?: string;
  remark_corp_name?: string;
  remark_mobiles?: string[];
  state?: string;
  tags?: Array<{ group_name: string; tag_name: string; type: number }>;
};

type FollowListItem = {
  external_contact: ExternalContact;
  follow_info: FollowUser;
};

const callExternal = async <T>(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>
): Promise<T | null> => {
  const config = getWechatWorkConfig();
  if (!config || !config.contactSecret) {
    return null;
  }

  const token = await fetchAccessToken(
    config.corpId,
    config.contactSecret,
    `contact:${config.corpId}`
  );
  if (!token) return null;

  const url = `https://qyapi.weixin.qq.com${path}${path.includes('?') ? '&' : '?'}access_token=${token}`;

  try {
    const init: RequestInit = { method };
    if (method === 'POST') {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body ?? {});
    }

    const response = await fetch(url, init);
    const data = (await response.json()) as { errcode?: number; errmsg?: string } & T;
    if (data.errcode && data.errcode !== 0) {
      console.error('[wechat-work] external_contact 调用失败', path, data);
      return null;
    }
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[wechat-work] external_contact 异常', path, message);
    return null;
  }
};

export const listFollowUsers = async (): Promise<string[]> => {
  const result = await callExternal<{ follow_user: string[] }>(
    '/cgi-bin/externalcontact/get_follow_user_list'
  );
  return result?.follow_user ?? [];
};

export const listExternalContactIds = async (userid: string): Promise<string[]> => {
  const result = await callExternal<{ external_userid: string[] }>(
    `/cgi-bin/externalcontact/list?userid=${encodeURIComponent(userid)}`
  );
  return result?.external_userid ?? [];
};

export const getExternalContactDetail = async (
  externalUserid: string
): Promise<FollowListItem | null> => {
  const result = await callExternal<{ external_contact: ExternalContact; follow_user: FollowUser[] }>(
    `/cgi-bin/externalcontact/get?external_userid=${encodeURIComponent(externalUserid)}`
  );
  if (!result?.external_contact) return null;
  return {
    external_contact: result.external_contact,
    follow_info: result.follow_user?.[0] ?? { userid: '' },
  };
};

