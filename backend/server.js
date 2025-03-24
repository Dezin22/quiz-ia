const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const path = require("path");
const { OpenAI } = require("openai");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar CORS para aceitar requisições do GitHub Pages
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5000",
      "https://dezin22.github.io", // Corrigido para domínio base
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

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public"))); // Corrigido path para pasta public

// Conexão com MongoDB
const mongoURI = process.env.MONGODB_URI;
if (!mongoURI) {
  console.error("MONGODB_URI não está definida nas variáveis de ambiente!");
  process.exit(1);
}

let db;

async function connectToMongoDB() {
  try {
    const client = new MongoClient(mongoURI, {
      serverApi: {
        version: "1",
        strict: true,
        deprecationErrors: true,
      },
      ssl: true,
      sslValidate: false,
      retryWrites: true,
      w: "majority",
      // Configurações de pool atualizadas para versão mais recente
      maxPoolSize: 50,
      minPoolSize: 5,
      maxIdleTimeMS: 30000,
      connectTimeoutMS: 5000,
    });

    console.log("Tentando conectar ao MongoDB...");
    await client.connect();

    db = client.db("quiz-ia");
    console.log("Conectado ao MongoDB com sucesso!");

    // Configurar índices
    await setupDatabase();
  } catch (error) {
    console.error("Erro ao conectar ao MongoDB:", error);
    process.exit(1);
  }
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Cache em memória para categorias já usadas
const categoryCache = new Map();

// Função otimizada para gerar perguntas
async function generateQuestionWithAI() {
  try {
    const categories = [
      "tecnologia",
      "história",
      "ciência",
      "esportes",
      "geografia",
      "entretenimento",
      "literatura",
      "arte",
      "música",
      "cinema",
    ];

    const randomCategory =
      categories[Math.floor(Math.random() * categories.length)];
    const timestamp = new Date().getTime();

    // Prompt modificado para enfatizar originalidade
    const prompt = `Gere uma pergunta de quiz TOTALMENTE NOVA E ORIGINAL sobre ${randomCategory}. 
A pergunta deve ser específica e diferente das comuns.
Timestamp para garantir unicidade: ${timestamp}
Retorne apenas o JSON puro:
{"question":"[PERGUNTA ÚNICA]","options":["[A]","[B]","[C]","[D]"]","correctIndex":[0-3],"explanation":"[EXPLICAÇÃO]"}`;

    const response = await fetch(
      "https://api.deepseek.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            {
              role: "system",
              content:
                "Você é um gerador de perguntas originais. NUNCA repita perguntas. Seja específico e criativo.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.9, // Aumentado para mais variação
          max_tokens: 512,
          presence_penalty: 0.6, // Aumentado para evitar repetições
          frequency_penalty: 0.6, // Aumentado para evitar repetições
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        `Erro na API: ${data.error?.message || "Erro desconhecido"}`
      );
    }

    // Limpar a resposta de possíveis marcações markdown
    let jsonString = data.choices[0].message.content.trim();
    if (jsonString.startsWith("```")) {
      jsonString = jsonString.replace(/```json\n|\n```|```/g, "");
    }

    // Tentar fazer o parse do JSON limpo
    let parsedQuestion;
    try {
      parsedQuestion = JSON.parse(jsonString);
    } catch (parseError) {
      console.error("Erro no parsing do JSON:", jsonString);
      throw new Error("Formato de resposta inválido da IA");
    }

    // Validar a estrutura do JSON
    if (
      !parsedQuestion.question ||
      !Array.isArray(parsedQuestion.options) ||
      parsedQuestion.options.length !== 4 ||
      typeof parsedQuestion.correctIndex !== "number" ||
      !parsedQuestion.explanation
    ) {
      throw new Error("Resposta da IA não contém todos os campos necessários");
    }

    // Randomizar posição da resposta
    const correctOption = parsedQuestion.options[parsedQuestion.correctIndex];
    const otherOptions = parsedQuestion.options.filter(
      (_, i) => i !== parsedQuestion.correctIndex
    );

    // Embaralhar usando Fisher-Yates
    for (let i = otherOptions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [otherOptions[i], otherOptions[j]] = [otherOptions[j], otherOptions[i]];
    }

    const newCorrectIndex = Math.floor(Math.random() * 4);
    const shuffledOptions = [...otherOptions];
    shuffledOptions.splice(newCorrectIndex, 0, correctOption);

    return {
      question: parsedQuestion.question,
      options: shuffledOptions,
      correctIndex: newCorrectIndex,
      explanation: parsedQuestion.explanation,
      category: randomCategory,
    };
  } catch (error) {
    console.error("Erro ao gerar pergunta:", error);
    return getDefaultQuestion();
  }
}

// Pergunta padrão otimizada

// Rota otimizada para perguntas
app.post("/api/question", async (req, res) => {
  try {
    if (!db) throw new Error("Banco de dados não conectado");

    const usedQuestions = req.body.usedQuestions || [];
    let question = null;
    let attempts = 0;
    const maxAttempts = 10;

    while (!question && attempts < maxAttempts) {
      attempts++;
      console.log(`Tentativa ${attempts} de gerar pergunta única`);

      const newQuestion = await generateQuestionWithAI();

      // Verificar se a pergunta já existe
      const exists = await db
        .collection("questions")
        .findOne(
          { question: newQuestion.question },
          { projection: { _id: 1 } }
        );

      if (!exists && !usedQuestions.includes(newQuestion.question)) {
        question = newQuestion;
        try {
          await db.collection("questions").insertOne({
            ...question,
            createdAt: new Date(),
          });
          console.log("Nova pergunta única salva com sucesso!");
          break;
        } catch (insertError) {
          if (insertError.code !== 11000) {
            throw insertError;
          }
          console.log("Tentando gerar outra pergunta...");
          question = null;
          continue;
        }
      } else {
        console.log("Pergunta já existe, gerando nova...");
      }
    }

    if (!question) {
      throw new Error(
        "Não foi possível gerar uma pergunta única após várias tentativas"
      );
    }

    res.json(question);
  } catch (error) {
    console.error("Erro:", error);
    res.status(500).json({ error: error.message });
  }
});

// Rota para salvar resultados do quiz
app.post("/api/save-result", async (req, res) => {
  try {
    if (!db) {
      throw new Error("Conexão com o banco de dados não estabelecida");
    }

    const result = {
      ...req.body,
      timestamp: new Date(),
    };

    await db.collection("results").insertOne(result);
    res.status(201).json({ success: true });
  } catch (error) {
    console.error("Erro ao salvar resultado:", error);
    res.status(500).json({ error: "Erro ao salvar resultado" });
  }
});

// Rota para obter estatísticas
app.get("/api/stats", async (req, res) => {
  try {
    const totalResults = await db.collection("results").countDocuments();
    const correctAnswers = await db
      .collection("results")
      .countDocuments({ correct: true });

    // Perguntas mais acertadas
    const topQuestions = await db
      .collection("results")
      .aggregate([
        {
          $group: {
            _id: "$questionId",
            total: { $sum: 1 },
            correct: { $sum: { $cond: ["$correct", 1, 0] } },
          },
        },
        {
          $project: {
            _id: 1,
            total: 1,
            correct: 1,
            percentageCorrect: {
              $multiply: [{ $divide: ["$correct", "$total"] }, 100],
            },
          },
        },
        { $sort: { percentageCorrect: -1 } },
        { $limit: 5 },
      ])
      .toArray();

    res.json({
      totalQuizzes: Math.floor(totalResults / 10),
      totalQuestions: totalResults,
      correctPercentage: ((correctAnswers / totalResults) * 100).toFixed(2),
      topQuestions,
    });
  } catch (error) {
    console.error("Erro ao obter estatísticas:", error);
    res.status(500).json({ error: "Erro ao obter estatísticas" });
  }
});

// Modificar a função setupDatabase
async function setupDatabase() {
  try {
    // Primeiro, remover índices existentes
    await db.collection("questions").dropIndexes();
    await db.collection("results").dropIndexes();

    // Criar índice simples para questions
    await db
      .collection("questions")
      .createIndex({ question: 1 }, { unique: true });

    // Índice para results
    await db.collection("results").createIndex({
      questionId: 1,
      timestamp: 1,
    });

    console.log("Índices recriados com sucesso!");
  } catch (error) {
    console.error("Erro ao criar índices:", error);
  }
}

// Iniciar servidor
async function startServer() {
  try {
    await connectToMongoDB();
    app.listen(PORT, () => {
      console.log(`Servidor rodando em http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Erro ao iniciar servidor:", error);
    process.exit(1);
  }
}

startServer();
