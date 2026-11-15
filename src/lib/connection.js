export function readConnectionEvent(event) {
  const body = event?.body && (event.body.action || event.body.connectionId) ? event.body : (event || {});
  return {
    action: body.action || null,
    name: body.name || '',
    connectionId: body.connectionId || null,
    configProperties: body.configProperties || {},
  };
}
