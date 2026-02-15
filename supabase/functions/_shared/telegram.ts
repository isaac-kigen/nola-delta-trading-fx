export interface TelegramSendResult {
  ok: boolean;
  status: number;
  messageId: string | null;
  error: string | null;
}

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
  result?: {
    message_id?: number;
  };
}

export async function sendTelegramMessage(params: {
  botToken: string;
  chatId: string;
  text: string;
  timeoutMs?: number;
}): Promise<TelegramSendResult> {
  const endpoint = `https://api.telegram.org/bot${params.botToken}/sendMessage`;
  const controller = new AbortController();
  const timeoutMs = Math.max(1_000, Math.trunc(params.timeoutMs ?? 10_000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        chat_id: params.chatId,
        text: params.text,
        disable_web_page_preview: true,
      }),
    });

    const payload = await response.json().catch(() => null) as TelegramApiResponse | null;
    if (!response.ok || !payload?.ok) {
      return {
        ok: false,
        status: response.status,
        messageId: null,
        error: payload?.description ?? `Telegram send failed with HTTP ${response.status}`,
      };
    }

    return {
      ok: true,
      status: response.status,
      messageId: payload.result?.message_id
        ? String(payload.result.message_id)
        : null,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      messageId: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}
