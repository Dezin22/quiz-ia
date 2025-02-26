// Configurar CORS para aceitar requisições do GitHub Pages
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5000",
      "https://dezin22.github.io/quiz-ia/", // Substitua com seu domínio do GitHub Pages
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
