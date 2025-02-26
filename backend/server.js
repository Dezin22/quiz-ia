// Configurar CORS para aceitar requisições do GitHub Pages
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5000",
      "https://seu-usuario.github.io", // Substitua com seu domínio do GitHub Pages
    ],
    methods: ["GET", "POST"],
    credentials: true,
  })
);

// Adicionar middleware para verificar origem
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  next();
});
