/**
 * Hand-run scripts that call Anthropic with their own client (PRO-1316):
 * `scriptAnthropic` marks the process as the script (`billCostsToScript`) and
 * records every `messages.create` answer in `cost_events` as `script_<name>`,
 * with no user (system cost, `systemCostEur`), so nothing paid escapes the
 * ledger. The script awaits `flushCostEvents()` before it exits, or the last
 * inserts are lost.
 *
 * Only the direct client: «Mimo remoto» (D-168) costs 0 $ of API and isn't
 * wrapped. Scripts that only go through a service (AnthropicProvider, the
 * matcher…) call `billCostsToScript` themselves: the service records, the
 * ledger relabels.
 */
import { billCostsToScript, recordAnthropicCost } from './costLedger.js'

export interface MessagesCreateLike {
  messages: { create(args: any, opts?: any): Promise<any> }
}

/** Same client, but each answer with `usage` is recorded as `script_<name>` (system). */
export function scriptAnthropic<T extends MessagesCreateLike>(name: string, client: T): T {
  billCostsToScript(name)
  const create = async (args: any, opts?: any) => {
    const res = await client.messages.create(args, opts)
    // Priced by the model asked for (the answer may name a dated snapshot).
    recordAnthropicCost(`script_${name}`, args?.model ?? res?.model, res?.usage, null)
    return res
  }
  const messages = new Proxy(client.messages, { get: (target, prop) => (prop === 'create' ? create : bound(target, prop)) })
  return new Proxy(client, { get: (target, prop) => (prop === 'messages' ? messages : bound(target, prop)) })
}

/** The SDK keeps private fields: its methods must run on the real object, not on the proxy. */
function bound(target: object, prop: string | symbol): unknown {
  const value = Reflect.get(target, prop)
  return typeof value === 'function' ? value.bind(target) : value
}
