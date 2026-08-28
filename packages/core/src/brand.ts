/** Create an opaque identifier that cannot be mixed with another identifier type. */
export type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name
}

/** Identifier for one locally configured ORYH connection. */
export type ConnectionId = Brand<string, 'ConnectionId'>

/** Identifier for a cached deterministic operation result. */
export type OperationResultId = Brand<string, 'OperationResultId'>

/** Construct a connection identifier at the Host-owned creation point. */
export function connectionId(value: string): ConnectionId {
  return value as ConnectionId
}

/** Construct an operation result identifier at the Host-owned creation point. */
export function operationResultId(value: string): OperationResultId {
  return value as OperationResultId
}
