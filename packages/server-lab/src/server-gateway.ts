/** Reuse the public Gateway transport with admission on every unary and Remote stream invocation. */
import Gateway, { type InvokeRemoteRequest } from '@deepseek-ai/dsh-api-gateway'
import type { Context } from '@deepseek-ai/cordis'

export interface GatewayAdmission {
  admit(request: InvokeRemoteRequest): Promise<InvokeRemoteRequest>
}
declare module '@deepseek-ai/cordis' { interface Context { oryhGatewayAdmission: GatewayAdmission } }
export default class ServerGateway extends Gateway {
  static override inject = [...Gateway.inject, 'oryhGatewayAdmission']
  override async invoke(request: InvokeRemoteRequest): Promise<unknown> {
    return super.invoke(await this.ctx.oryhGatewayAdmission.admit(request))
  }
  override async stream(request: InvokeRemoteRequest): Promise<AsyncIterable<unknown>> {
    return super.stream(await this.ctx.oryhGatewayAdmission.admit(request))
  }
}
