export function main(event) {
  console.log('event:', JSON.stringify(event));

  return {
    statusCode: 200,
    body: {
      ok: true,
      message: 'rrpaymentupdate reached',
      event
    }
  };
}