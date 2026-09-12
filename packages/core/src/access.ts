import type {OryhIdentity} from './contracts.js'
import {OryhClientError} from './errors.js'
import {canAccessPage,hasPermission} from '@oryh/ai-client-pages'
// The page table and its entry rules live in @oryh/ai-client-pages so the Host plugin and
// the client read the same source. These re-exports keep every existing import working.
export type {PageId as AccessPage} from '@oryh/ai-client-pages'
export {canAccessPage,hasPermission}
// The throwing wrappers stay here: they raise OryhClientError, which lives in this package,
// so moving them would point the registry back at the core and close a dependency cycle.
export function requirePage(identity:OryhIdentity,page:string):void {
 if(!canAccessPage(identity,page))throw new OryhClientError('当前账号没有此业务功能的访问权限。','request-failed')
}
export function requirePermission(identity:OryhIdentity,verb:string):void {
 if(!hasPermission(identity,verb))throw new OryhClientError('当前账号没有执行此操作的权限。','request-failed')
}
