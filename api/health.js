export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({ status: 'ok', projeto: 'qualidadegrupogalva', vercel: true });
}
