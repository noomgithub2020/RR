exports.main = async function main(event) {
  console.log('FUNCTION START');
  console.log('event:', JSON.stringify(event));
  return {
    statusCode: 200,
    body: { ok: true }
  };
};
