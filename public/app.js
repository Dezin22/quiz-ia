// Elementos do DOM
const startScreen = document.getElementById("start-screen");
const quizScreen = document.getElementById("quiz-screen");
const feedbackScreen = document.getElementById("feedback-screen");
const resultScreen = document.getElementById("result-screen");
const startButton = document.getElementById("start-button");
const newQuestionButton = document.getElementById("new-question-button");
const nextButton = document.getElementById("next-button");
const restartButton = document.getElementById("restart-button");
const questionText = document.getElementById("question-text");
const optionsContainer = document.getElementById("options-container");
const questionNumber = document.getElementById("question-number");
const correctAnswer = document.getElementById("correct-answer");
const wrongAnswer = document.getElementById("wrong-answer");
const correctOption = document.getElementById("correct-option");
const score = document.getElementById("score");
const percentage = document.getElementById("percentage");
const timer = document.getElementById("timer");

// Configurações do quiz
let currentQuestion = 0;
let correctAnswers = 0;
let totalQuestions = 10;
let selectedOption = null;
let timeLeft = 30;
let timerInterval;
let usedQuestions = new Set();

// Dados da pergunta atual
let currentQuizData = {
  question: "",
  options: [],
  correctIndex: 0,
  explanation: "",
};

// Modificar a URL da API para apontar para seu backend hospedado
const API_URL =
  window.location.hostname === "localhost"
    ? "http://localhost:3000"
    : "https://quiz-ia-backend.onrender.com"; // URL fornecida pelo Render

// API para obter perguntas da IA
async function fetchQuestion() {
  try {
    const response = await fetch(`${API_URL}/api/question`, {
      method: "POST", // Mudando para POST para enviar as perguntas já usadas
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        usedQuestions: Array.from(usedQuestions),
      }),
    });

    if (!response.ok) {
      throw new Error(`Erro HTTP: ${response.status}`);
    }
    const data = await response.json();
    console.log("Pergunta recebida:", data);

    // Adicionar a pergunta ao conjunto de perguntas usadas
    usedQuestions.add(data.question);
    return data;
  } catch (error) {
    console.error("Erro ao buscar pergunta:", error);
    return null;
  }
}

// Salvar resultados no banco de dados
function saveToDatabase(data) {
  // Criar um identificador único para o resultado
  const resultKey = `${currentQuizData.question}-${data.userAnswer}-${data.correct}-${data.timeSpent}`;

  // Verificar se já salvamos este resultado específico
  if (localStorage.getItem(resultKey)) {
    console.log("Resultado já foi salvo anteriormente");
    return;
  }

  console.log("Salvando no banco de dados:", data);

  fetch(`${API_URL}/api/save-result`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...data,
      questionId: currentQuizData.question,
      timestamp: new Date(),
    }),
  })
    .then((response) => {
      if (response.ok) {
        // Marcar como salvo no localStorage
        localStorage.setItem(resultKey, "true");
      }
    })
    .catch((error) => {
      console.error("Erro ao salvar resultado:", error);
    });
}

// Iniciar o quiz
startButton.addEventListener("click", () => {
  startScreen.classList.add("hidden");
  quizScreen.classList.remove("hidden");
  loadNewQuestion();
});

// Carregar nova pergunta
async function loadNewQuestion() {
  clearInterval(timerInterval);
  resetTimer();

  // Limpar estado anterior
  feedbackScreen.classList.add("hidden");
  correctAnswer.classList.add("hidden");
  wrongAnswer.classList.add("hidden");
  nextButton.classList.add("hidden");
  optionsContainer.innerHTML = "";
  selectedOption = null;

  // Resetar texto do botão de nova pergunta
  newQuestionButton.textContent = "Nova Pergunta";
  newQuestionButton.classList.remove("hidden");

  // Mostrar loading
  questionText.textContent = "Carregando pergunta...";
  newQuestionButton.disabled = true; // Desabilitar botão durante carregamento

  try {
    // Obter nova pergunta da API
    const questionData = await fetchQuestion();
    if (questionData) {
      currentQuizData = questionData;

      // Atualizar interface
      questionText.textContent = questionData.question;

      // Criar opções
      questionData.options.forEach((option, index) => {
        const optionButton = document.createElement("button");
        optionButton.className =
          "block w-full text-left px-4 py-3 border rounded-lg hover:bg-gray-50 transition duration-200";
        optionButton.textContent = option;
        optionButton.dataset.index = index;

        optionButton.addEventListener("click", () => {
          // Remover seleção anterior
          document
            .querySelectorAll("#options-container button")
            .forEach((btn) => {
              btn.classList.remove("bg-indigo-100", "border-indigo-300");
            });

          // Marcar opção selecionada
          optionButton.classList.add("bg-indigo-100", "border-indigo-300");
          selectedOption = parseInt(index);

          // Mostrar botão de verificar
          newQuestionButton.textContent = "Verificar Resposta";
          newQuestionButton.classList.remove("hidden");
        });

        optionsContainer.appendChild(optionButton);
      });

      // Iniciar timer
      startTimer();
    } else {
      questionText.textContent =
        "Erro ao carregar pergunta. Tente novamente mais tarde.";
    }
  } catch (error) {
    questionText.textContent = "Erro ao carregar pergunta. Tente novamente.";
  } finally {
    newQuestionButton.disabled = false; // Reabilitar botão
  }
}

// Verificar resposta
function checkAnswer() {
  clearInterval(timerInterval);

  if (selectedOption === null) {
    alert("Por favor, selecione uma opção.");
    return;
  }

  feedbackScreen.classList.remove("hidden");

  const isCorrect = selectedOption === currentQuizData.correctIndex;

  if (isCorrect) {
    correctAnswer.classList.remove("hidden");
    document.getElementById("correct-explanation").textContent =
      currentQuizData.explanation;
    correctAnswers++;
  } else {
    wrongAnswer.classList.remove("hidden");
    correctOption.textContent =
      currentQuizData.options[currentQuizData.correctIndex];
    document.getElementById("wrong-explanation").textContent =
      currentQuizData.explanation;
  }

  // Salvar resultado no banco
  saveToDatabase({
    userAnswer: selectedOption,
    correct: isCorrect,
    timeSpent: 30 - timeLeft,
  });

  currentQuestion++;

  // Verificar se é a última pergunta
  if (currentQuestion >= totalQuestions) {
    nextButton.textContent = "Ver Resultados";
  }

  newQuestionButton.classList.add("hidden");
  nextButton.classList.remove("hidden");
}

// Próxima pergunta ou mostrar resultados
nextButton.addEventListener("click", () => {
  if (currentQuestion >= totalQuestions) {
    showResults();
  } else {
    questionNumber.textContent = `Pergunta ${
      currentQuestion + 1
    }/${totalQuestions}`;
    loadNewQuestion();
  }
});

// Botão de nova pergunta/verificar resposta
newQuestionButton.addEventListener("click", () => {
  if (newQuestionButton.textContent === "Verificar Resposta") {
    checkAnswer();
  } else {
    loadNewQuestion();
  }
});

// Mostrar resultados finais
function showResults() {
  quizScreen.classList.add("hidden");
  feedbackScreen.classList.add("hidden");
  resultScreen.classList.remove("hidden");

  score.textContent = correctAnswers;
  percentage.textContent = Math.round((correctAnswers / totalQuestions) * 100);
}

// Reiniciar o quiz
restartButton.addEventListener("click", () => {
  currentQuestion = 0;
  correctAnswers = 0;
  selectedOption = null;
  usedQuestions.clear(); // Limpar perguntas usadas

  resultScreen.classList.add("hidden");
  quizScreen.classList.remove("hidden");

  questionNumber.textContent = `Pergunta ${
    currentQuestion + 1
  }/${totalQuestions}`;
  newQuestionButton.textContent = "Nova Pergunta";
  newQuestionButton.classList.remove("hidden");

  loadNewQuestion();
});

// Funções do timer
function startTimer() {
  timeLeft = 30;
  timer.textContent = timeLeft;

  timerInterval = setInterval(() => {
    timeLeft--;
    timer.textContent = timeLeft;

    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      checkAnswer();
    }
  }, 1000);
}

function resetTimer() {
  timeLeft = 30;
  timer.textContent = timeLeft;
}

// Inicialização
questionNumber.textContent = `Pergunta ${
  currentQuestion + 1
}/${totalQuestions}`;
