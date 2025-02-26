const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const path = require("path");
const { OpenAI } = require("openai");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Conexão com MongoDB
const mongoURI = process.env.MONGODB_URI || "mongodb://localhost:27017/quiz-ia";
let db;

async function connectToMongoDB() {
  try {
    const client = new MongoClient(mongoURI);
    await client.connect();
    db = client.db("quiz-ia");
    console.log("Conectado ao MongoDB com sucesso!");
  } catch (error) {
    console.error("Erro ao conectar ao MongoDB:", error);
    process.exit(1);
  }
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Rota para obter uma nova pergunta da IA
app.post("/api/question", async (req, res) => {
  try {
    console.log("Recebida requisição para /api/question");
    const usedQuestions = req.body.usedQuestions || [];

    /* 
    // CÓDIGO PARA USAR APÓS TER 1000 PERGUNTAS NO BANCO
    const totalQuestions = await db.collection("questions").countDocuments();
    
    if (totalQuestions >= 1000) {
      // Tentar obter pergunta do banco que não foi usada na sessão atual
      const availableQuestions = await db.collection("questions")
        .find({ question: { $nin: usedQuestions } })
        .toArray();

      if (availableQuestions.length > 0) {
        const randomIndex = Math.floor(Math.random() * availableQuestions.length);
        return res.json(availableQuestions[randomIndex]);
      }
    }
    */

    // Tentar obter uma pergunta nova da IA
    let question = null;
    let attempts = 0;
    const maxAttempts = 5;

    while (!question && attempts < maxAttempts) {
      attempts++;
      const newQuestion = await generateQuestionWithAI();

      if (!usedQuestions.includes(newQuestion.question)) {
        question = newQuestion;
        break;
      }
    }

    if (!question) {
      throw new Error(
        "Não foi possível gerar uma pergunta única após várias tentativas"
      );
    }

    // Salvar no banco para histórico
    try {
      await db.collection("questions").insertOne({
        ...question,
        createdAt: new Date(),
      });
    } catch (error) {
      console.log("Pergunta já existe no banco, ignorando inserção");
    }

    res.json(question);
  } catch (error) {
    console.error("Erro ao obter pergunta:", error);
    res
      .status(500)
      .json({ error: "Erro ao gerar pergunta", details: error.message });
  }
});

// Função para gerar perguntas usando a IA
async function generateQuestionWithAI() {
  try {
    // Lista de categorias para diversificar as perguntas
    const categories = [
      "tecnologia",
      "história",
      "ciência",
      "esportes",
      "geografia",
      "entretenimento",
      "literatura",
      "arte",
    ];

    const randomCategory =
      categories[Math.floor(Math.random() * categories.length)];

    // Prompt para a IA gerar uma pergunta de quiz
    const prompt = `Gere uma pergunta de quiz sobre ${randomCategory} com 4 opções de resposta.
Formato:
{
  "question": "A pergunta aqui",
  "options": ["Opção 1", "Opção 2", "Opção 3", "Opção 4"],
  "correctIndex": 0,
  "explanation": "Explicação sobre a resposta correta"
}
Obs: correctIndex deve ser um número (0-3) representando o índice da resposta correta.`;

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
                "Você é um assistente especializado em gerar perguntas de quiz.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.7,
          max_tokens: 2048,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        `Erro na API: ${data.error?.message || "Erro desconhecido"}`
      );
    }

    const aiResponse = data.choices[0].message.content;

    try {
      // Tentar extrair o JSON da resposta
      const jsonStartIndex = aiResponse.indexOf("{");
      const jsonEndIndex = aiResponse.lastIndexOf("}") + 1;

      if (jsonStartIndex === -1 || jsonEndIndex === -1) {
        throw new Error("Formato JSON não encontrado na resposta");
      }

      const jsonString = aiResponse.substring(jsonStartIndex, jsonEndIndex);
      const parsedQuestion = JSON.parse(jsonString);

      // Validar se o formato está correto
      if (
        !parsedQuestion.question ||
        !Array.isArray(parsedQuestion.options) ||
        parsedQuestion.options.length !== 4 ||
        typeof parsedQuestion.correctIndex !== "number" ||
        !parsedQuestion.explanation
      ) {
        throw new Error("Formato de pergunta inválido");
      }

      return parsedQuestion;
    } catch (parseError) {
      console.error("Erro ao analisar resposta da IA:", parseError);
      console.log("Resposta recebida:", aiResponse);

      // Retornar uma pergunta padrão em caso de erro de parsing
      return {
        question: "Qual é a linguagem de programação mais popular atualmente?",
        options: ["JavaScript", "Python", "Java", "C++"],
        correctIndex: 0,
        explanation:
          "JavaScript é a linguagem mais usada na web e tem ampla adoção no desenvolvimento frontend e backend.",
      };
    }
  } catch (error) {
    console.error("Erro ao gerar pergunta com IA:", error);

    // Retornar uma pergunta padrão em caso de erro
    return {
      question: "Qual é a linguagem de programação mais popular atualmente?",
      options: ["JavaScript", "Python", "Java", "C++"],
      correctIndex: 0,
      explanation:
        "JavaScript é a linguagem mais usada na web e tem ampla adoção no desenvolvimento frontend e backend.",
    };
  }
}

// Rota para salvar resultados do quiz
app.post("/api/save-result", async (req, res) => {
  try {
    const result = {
      ...req.body,
      timestamp: new Date(),
    };

    // Verificar se já existe um resultado idêntico
    const existingResult = await db.collection("results").findOne({
      questionId: result.questionId,
      userAnswer: result.userAnswer,
      correct: result.correct,
      timeSpent: result.timeSpent,
    });

    if (!existingResult) {
      await db.collection("results").insertOne(result);
    }

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

// Modificar a função setupDatabase para adicionar índices compostos
async function setupDatabase() {
  try {
    // Índice único para questions
    await db
      .collection("questions")
      .createIndex({ question: 1 }, { unique: true });

    // Índice composto único para results
    await db.collection("results").createIndex(
      {
        questionId: 1,
        userAnswer: 1,
        correct: 1,
        timeSpent: 1,
      },
      { unique: true }
    );

    // Índice para performance
    await db.collection("questions").createIndex({ createdAt: 1 });

    console.log("Índices criados com sucesso!");
  } catch (error) {
    console.error("Erro ao criar índices:", error);
  }
}

// Iniciar servidor
connectToMongoDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Servidor rodando na porta http://localhost:${PORT}/`);
  });
});
