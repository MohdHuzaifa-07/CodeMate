/** Standard error reply for socket acknowledgements. */
export const fail = (reply, code, message) => reply({ ok: false, error: { code, message } });