// Cloudflare Worker의 proxy URL
const WORKER_PROXY_URL = "https://odd-dream-7597.kyojun75.workers.dev/proxy";

// DOM 요소들
const btnBrainstorm    = document.getElementById("btnBrainstorm");
const brainstormResult = document.getElementById("brainstormResult");
const topicInput       = document.getElementById("topic");

const ideaSelect       = document.getElementById("ideaSelect");
const btnVocab         = document.getElementById("btnVocab");
const vocabResult      = document.getElementById("vocabResult");

// **직접 입력** 관련 DOM 
const customIdeaContainer = document.getElementById("customIdeaContainer"); 
const customIdeaInput     = document.getElementById("customIdeaInput");     

const draftText        = document.getElementById("draftText");
const btnDraftFeedback = document.getElementById("btnDraftFeedback");
const draftFeedbackResult = document.getElementById("draftFeedbackResult");

const finalText        = document.getElementById("finalText");
const btnImportDraft   = document.getElementById("btnImportDraft");
const btnFinalSubmit   = document.getElementById("btnFinalSubmit");
const finalResult      = document.getElementById("finalResult");

// 이미지 업로드 및 카메라 촬영 버튼
const uploadDraft = document.getElementById("uploadDraft");
const cameraDraft = document.getElementById("cameraDraft");
const uploadFinal = document.getElementById("uploadFinal");
const cameraFinal = document.getElementById("cameraFinal");


// 난이도
const studentDifficultySelect = document.getElementById("studentDifficulty");

// 아이디어 목록을 저장할 배열
let ideaList = []; 

// firstDraft의 전역 변수를 선언해 초기값은 빈 문자열로
let firstDraftContent = "";

/**
 * 이미지 업로드 핸들러 
 */
async function handleImageUpload(event) {
  const file = event.target.files[0]; // 첫 번째 선택한 파일
  if (!file) return;

  const targetTextArea = event.target.id.includes("Draft") ? draftText : finalText;
  targetTextArea.innerText = "이미지 처리 중입니다...";

  try {
    // 이미지를 Base64로 변환
    const base64Image = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });

    // 이미지 호출
    const response = await fetch(WORKER_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Please extract the exact text from the image as it appears. Do not provide any additional commentary or corrections.",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`,
                },
              },
            ],
          },
        ],
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      throw new Error("이미지 처리 중 오류가 발생했습니다.");
    }

    const data = await response.json();
    const extractedText = data.choices[0].message.content;

   // 추출된 텍스트를 텍스트 영역에 표시
    targetTextArea.innerText = extractedText;
    targetTextArea.focus();
  } catch (error) {
    console.error("Error:", error);
    targetTextArea.innerText = "이미지 처리 중 오류가 발생했습니다: " + error.message;
  }
}


// 이미지 관련 이벤트 리스너
uploadDraft.addEventListener("change", handleImageUpload);
cameraDraft.addEventListener("change", handleImageUpload);
uploadFinal.addEventListener("change", handleImageUpload);
cameraFinal.addEventListener("change", handleImageUpload);


/**
 * OpenAI(Proxy) 스트리밍 함수
 * - chunk(조각)마다 문자열을 이어붙여(buffer) 한 줄 단위로만 JSON.parse()
 * - onToken(content)가 호출될 때마다, 현재까지 수신된 text를 UI에 표시 가능
 */
async function callOpenAIAPIStream(systemPrompt, userPrompt, onToken) {
  const endpoint = WORKER_PROXY_URL;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
      // => Authorization은 Worker에서  처리
    },
    body: JSON.stringify({
      model: "gpt-4o",   
      messages: messages,
      stream: true,
      max_tokens: 512,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorMsg = await response.text();
    throw new Error("OpenAI API(Worker) 에러: " + errorMsg);
  }

  // SSE(Stream) 수신
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = ""; // 누적 버퍼
  let done = false;

  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;

    if (value) {
      buffer += decoder.decode(value, { stream: true });

      // 줄 단위로 분할
      const lines = buffer.split("\n");

      // 맨 마지막 줄은 아직 끝나지 않았을 수 있으므로 buffer에 남긴다
      buffer = lines.pop();

      // 나머지 완성된 줄들 처리
      for (let line of lines) {
        const trimmed = line.trim();
        if (trimmed === "data: [DONE]") {
          // 스트리밍 종료
          return;
        }
        if (trimmed.startsWith("data: ")) {
          const jsonStr = trimmed.replace("data: ", "");
          if (jsonStr !== "") {
            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed?.choices?.[0]?.delta?.content;
              if (content) {
                onToken(content);
              }
            } catch (err) {
              // JSON 파싱 실패(중간에 끊긴 경우 등)는 무시
            }
          }
        }
      }
    }
  }
}





// (B) 난이도 해석 함수
function getDifficultyDescription() {
  const diff = studentDifficultySelect.value;
  if (diff === "상") {
    return "Advanced English learners who are already familiar with English sentence structures and can handle advanced grammar and vocabulary.";
  } else if (diff === "중") {
    return "Korean elementary 3rd graders who are learning basic English grammar, simple sentence structures, and everyday vocabulary";
  } else {
    return "Absolute beginners who are just starting to learn English and are focusing on basic words and phonics.";
  }
}

// (C) 그래프 업데이트 함수  
function updateGraphWithScores(ideaScore, structScore, accScore) {
  const circles = document.querySelectorAll('.circle .progress');
  const values = document.querySelectorAll('.circle .value');
  const circleLength = 377; // r=60 => 둘레≈377

  // 아이디어
  let offset = circleLength - (circleLength * ideaScore) / 100;
  circles[0].style.strokeDashoffset = offset;
  values[0].innerHTML = `${ideaScore}<span style="font-size: 0.6em;"> / 100</span>`;

  // 글의 구성
  offset = circleLength - (circleLength * structScore) / 100;
  circles[1].style.strokeDashoffset = offset;
  values[1].innerHTML = `${structScore}<span style="font-size: 0.6em;"> / 100</span>`;

  // 글의 정확성
  offset = circleLength - (circleLength * accScore) / 100;
  circles[2].style.strokeDashoffset = offset;
  values[2].innerHTML = `${accScore}<span style="font-size: 0.6em;"> / 100</span>`;

  // 총점
  const total = ideaScore + structScore + accScore; // 0~300
  offset = circleLength - (circleLength * total) / 300;
  circles[3].style.strokeDashoffset = offset;
  values[3].innerHTML = `${total}<span style="font-size: 0.6em;"> / 300</span>`;
}


// (1) Brainstorm 버튼 (최대 6개 아이디어 - 번호 형태 추출)
btnBrainstorm.addEventListener("click", async () => {
  const topic = topicInput.value.trim();
  if (!topic) {
    alert("주제를 입력하세요!");
    return;
  }

  brainstormResult.textContent = "아이디어 생성 중입니다...\n";
  ideaList = []; // 초기화

  const difficultyDesc = getDifficultyDescription();

  // system prompt
  const systemPrompt = `
  You are a kind and encouraging English tutor who helps young Korean students develop ideas for writing in English.
  The student's difficulty is: ${difficultyDesc}.
  Please provide numbered key ideas (1) ~ 6)) as writing prompts. Use Korean except the key ideas and example sentences.
  `;

  // user prompt
  const userPrompt = `
  Topic: "${topic}"
  
  First, write a brief overall comment about the topic in Korean.
  Then, refer to the format below and propose 6 key ideas that can help develop the topic. 
  
  Follow this format:

       1) weather (날씨)
          - 좋아하는 계절의 날씨에 대해 써보세요. 
          - 예: Spring is warm. (봄은 따뜻하다.)

       2) activities (활동)
         - 그 계절에 즐길 수 있는 활동에 대해 적어보세요. 
         - 예: I go swimming in summer. (나는 여름에 수영하러 간다.)

       3) feelings (기분)
         - 그 계절이 당신에게 어떤 기분을 주는지 적어보세요. 
         - 예: I feel happy because I can play outside. (나는 밖에서 놀 수 있어서 행복하다.)

   Make your examples simple and fun!
  `;

  let accumulatedText = "";
  try {
    await callOpenAIAPIStream(systemPrompt, userPrompt, (token) => {
      accumulatedText += token;
      brainstormResult.textContent = accumulatedText;
    });

    // [아이디어 목록 파싱] - '1) ...' 형식의 줄만 추출, 최대 6개
    const bulletRegex = /^\d+\)\s/; // ex) 1) , 2) ...
    let lines = accumulatedText.split("\n")
      .map(x => x.trim())
      .filter(line => bulletRegex.test(line));

    // 최대 6개까지만 추출
    ideaList = lines.slice(0, 6);

    // drop-down 갱신
    ideaSelect.innerHTML = "";
    ideaList.forEach((idea, idx) => {
      const option = document.createElement("option");
      option.value = idea;
      option.textContent = `${idea.substring(0,40)}`;
      ideaSelect.appendChild(option);
    });

    // '직접 입력' 항목 추가 (마지막)
    const customOption = document.createElement("option");
    customOption.value = "custom";
    customOption.textContent = "직접 입력";
    ideaSelect.appendChild(customOption);

  } catch (err) {
    console.error(err);
    brainstormResult.textContent = "에러 발생: " + err.message;
  }
});

// **직접 입력** 기능: Drop-down 변경 시에 텍스트박스 표시 여부 결정
ideaSelect.addEventListener("change", () => {
  if (ideaSelect.value === "custom") {
    customIdeaContainer.style.display = "block";
  } else {
    customIdeaContainer.style.display = "none";
    // 필요 시 customIdeaInput.value = ""; 로 초기화할 수도 있음
  }
});

// (2) Idea Development 버튼
btnVocab.addEventListener("click", async () => {
  let selectedIdea = ideaSelect.value.trim();
  if (!selectedIdea) {
    alert("1번 과정을 먼저 진행하세요.");
    return;
  }
  // **직접 입력** 선택 시, customIdeaInput 사용
  if (selectedIdea === "custom") {
    selectedIdea = customIdeaInput.value.trim();
    if (!selectedIdea) {
      alert("직접 입력한 아이디어를 작성하세요!");
      return;
    }
  }

  vocabResult.textContent = "Detail 아이디어 생성 중입니다...\n";

  const difficultyDesc = getDifficultyDescription();
  const topic = topicInput.value.trim(); // 사용자가 입력한 Topic도 함께 전달
  
  const systemPrompt = `
  You are an English tutor who helps students expand a key idea into more detailed content.
  The student's language level is: ${difficultyDesc}.
  Use Korean except the keywords and example sentences.
  `;

  const userPrompt = `
  We have an overall Topic: "${topic}"
  And a specific chosen Key Idea: "${selectedIdea}"

  Propose six detailed and relevant keywords that can further expand the Key Idea.

  For each keyword, include:  
   - A simple suggestion in Korean to expand the Key Idea using the keyword.  
   - An example sentence in English that demonstrates how the keyword can be used effectively in the writing.  
  
  Follow this format:
  
  1) adventure (모험)
    - 여행에서 있었던 흥미 진진한 활동에 대해 묘사하세요.
    - 예: Our trip was full of adventure as we explored the hidden caves. (우리의 여행은 숨겨진 동굴을 탐험하며 모험으로 가득 찼다.)

  2) scenery (풍경)
    - 여행을 통해 목격한 아름다운 풍경을 묘사하세요.
    - 예: The mountain scenery was breathtaking and unforgettable. (산의 풍경은 숨이 멎을 만큼 아름답고 잊을 수 없었다.)
  
  Make your examples simple and clear!
  `;

  let accumulatedText = "";
  try {
    await callOpenAIAPIStream(systemPrompt, userPrompt, (token) => {
      accumulatedText += token;
      vocabResult.textContent = accumulatedText;
    });
  } catch (err) {
    console.error(err);
    vocabResult.textContent = "에러 발생: " + err.message;
  }
});

// (3) First Draft → [AI 피드백 생성]
btnDraftFeedback.addEventListener("click", async () => {
  const draft = draftText.innerText.trim();
  if (!draft) {
    alert("초안 글을 입력해주세요!");
    return;
  }
  firstDraftContent = draft; // 전역 변수에 보관
  draftFeedbackResult.textContent = "피드백 생성 중입니다...\n";

  const difficultyDesc = getDifficultyDescription();

  const systemPrompt = `
  You are a friendly English tutor. 
  The student's language level is: ${difficultyDesc}.
  Your role is to provide constructive and positive feedback on a student's first draft. 
  Always begin with a positive comment about what the student did well, and follow with clear suggestions for improvement. 
  Use simple Korean to ensure the feedback is approachable and easy to understand.
  `;

  const userPrompt = `
  Student's first draft:
  "${draft}"
  Provide feedback focusing on the following areas:  
   1) [아이디어]💡 Suggest how the student can add more interesting or relevant details to make the writing richer. Include one specific example.  
   2) [글의 구성]🧩 Point out how the student can enhance the organization or flow of their draft. Provide an example of a possible revision.  
   3) [글의 정확성]📝 Highlight key language issues (e.g., grammar, word choice) with a brief explanation and an example correction.  

  Start with a positive comment about what the student did well. Use Korean to make your feedback motivating and approachable.
  `;

  let accumulatedText = "";
  try {
    await callOpenAIAPIStream(systemPrompt, userPrompt, (token) => {
      accumulatedText += token;
      draftFeedbackResult.textContent = accumulatedText;
    });
  } catch (err) {
    console.error(err);
    draftFeedbackResult.textContent = "에러 발생: " + err.message;
  }
});

// (4) Final Draft
btnImportDraft.addEventListener("click", () => {
  finalText.innerText = draftText.innerText;
});

btnFinalSubmit.addEventListener("click", async () => {
  // 첫 번째 Draft 미작성 방어
  if (!firstDraftContent) {
    alert("First Draft를 먼저 작성해주세요!");
    return;
  }

  // Final Draft 비어있는지 체크
  const finalContent = finalText.innerText.trim();
  if (!finalContent) {
    alert("최종 글을 작성해주세요!");
    return;
  }

  finalResult.textContent = "최종 평가 생성 중입니다...\n";

    // 스크롤/포커스
    finalResult.scrollIntoView({ behavior: "smooth" });    
    finalResult.setAttribute("tabindex", "-1");
    finalResult.focus();
  
  const difficultyDesc = getDifficultyDescription();

  const systemPrompt = `
  You are an English tutor who evaluates a student's final draft.  
  The student's language level is: ${difficultyDesc}.
  Your role is to provide numeric scores (10 to 100) and detailed, actionable feedback for the following categories:

   - Idea Score: Evaluate the diversity of ideas, depth of thought, and relevance to the topic.  
     - Criteria:
       - 10~29: Minimal ideas with limited depth or relevance.  
       - 30~59: Some ideas are present but lack diversity or detail.  
       - 60~89: Ideas are moderately diverse and relevant but need more depth.  
       - 90~100: Clear, relevant, and diverse ideas.         
     - If the content is too short to evaluate, assign a low score (10~29).  

   - Structure Score: Assess logical flow, organization, and effective use of transitions.  
     - Criteria:
       - 10~29: Writing lacks clear organization or transitions.  
       - 30~59: Some organization exists, but transitions are weak, and logical flow is inconsistent.  
       - 60~89: Structure is developing but could improve with better transitions.  
       - 90~100: Well-organized writing with logical flow.         
     - If the writing is too short to demonstrate structure, assign a low score (10~29).  

   - Accuracy Score: Rate the accuracy of the final draft considering the student's language level. Focus on whether errors significantly impact clarity or communication.  
    - Criteria:
      - 10~29: Frequent and critical grammar errors that impede understanding.  
      - 30~59: Many noticeable errors that occasionally disrupt clarity but the overall meaning is understandable.  
      - 60~89: Functional grammar and vocabulary with minor errors that do not significantly affect understanding.  
      - 90~100: Highly accurate use of grammar, vocabulary, and spelling. Minimal or no error.  
    - If the writing is error-free or contains only minor errors that do not affect understanding, assign a score closer to 100, regardless of simplicity.   

  After providing the scores, write a Feedback section in Korean.  
  The feedback should:  
   1) Start with a positive comment about the student's effort and overall improvement.  
   2) Explain why the student received each score (Idea, Structure, Accuracy) with specific examples from their writing. 
   3) Provide clear suggestions for further improvement, focusing on the student's language level.  
   4) Use motivating and encouraging language to inspire the student to improve.
  `;

  const userPrompt = `
  Student's final draft:
  "${finalContent}"
  Student's first draft:  
  "${firstDraftContent}" 

  Please output in the following style (exactly one line each for the scores):
  
  Idea Score: XX
  Structure Score: YY
  Accuracy Score: ZZ

  Then, after those 3 lines, write "Feedback:" on a new line and provide the rest of your final feedback in Korean. 
  Start with a positive comment about the student's overall effort and improvements, highlighting specific examples of how the final draft has improved compared to the first draft. 
  Provide feedback in the following structure:  

  1) [아이디어]💡 
     - Evaluate the richness of ideas in the final draft.  
     - Comment on how well the ideas are developed and their relevance to the topic.  
     - Suggest specific ways to make the ideas more engaging or detailed.  

  2) [글의 구성]🧩
     - Evaluate the organization and logical flow in the final draft.  
     - Highlight strengths in structure and suggest improvements for better clarity and readability.  
     - Provide an example of how the organization could be improved.

  3) [글의 정확성]📝 
     - Evaluate grammar in the final draft.
     - Provide corrections or explanations if needed.   

  Ensure your feedback is motivating and encourages the student to continue improving their writing. Be concise but thorough.
`;

let accumulatedText = "";
try {
  await callOpenAIAPIStream(systemPrompt, userPrompt, (token) => {
    // 스트리밍된 텍스트를 누적
    accumulatedText += token;
    finalResult.textContent = accumulatedText;
    window.scrollTo(0, document.body.scrollHeight);
  });

  // 2) 스트리밍 완료 후, 점수 파싱 + 그래프 업데이트
  const ideaRegex = /Idea Score:\s*(\d{1,3})/i;
  const structRegex = /Structure Score:\s*(\d{1,3})/i;
  const accuRegex = /Accuracy Score:\s*(\d{1,3})/i;

  const ideaMatch = ideaRegex.exec(accumulatedText);
  const structureMatch = structRegex.exec(accumulatedText);
  const accuracyMatch = accuRegex.exec(accumulatedText);

  let ideaScore = null;
  let structureScore = null;
  let accuracyScore = null;

  if (ideaMatch) {
    const val = parseInt(ideaMatch[1], 10);
    if (!isNaN(val) && val >= 0 && val <= 100) {
      ideaScore = val;
    }
  }
  if (structureMatch) {
    const val = parseInt(structureMatch[1], 10);
    if (!isNaN(val) && val >= 0 && val <= 100) {
      structureScore = val;
    }
  }
  if (accuracyMatch) {
    const val = parseInt(accuracyMatch[1], 10);
    if (!isNaN(val) && val >= 0 && val <= 100) {
      accuracyScore = val;
    }
  }

  // 3) 그래프 업데이트
  if (ideaScore !== null && structureScore !== null && accuracyScore !== null) {
    updateGraphWithScores(ideaScore, structureScore, accuracyScore);
  }

  // 4) "Feedback:" 이후만 화면에 최종 표시
  let feedbackText = "";
  const feedbackIndex = accumulatedText.indexOf("Feedback:");
  if (feedbackIndex !== -1) {
    const startPos = feedbackIndex + "Feedback:".length;
    feedbackText = accumulatedText.substring(startPos).trim();
  } else {
    feedbackText = accumulatedText;
  }

  // 평가 결과 섹션 (Final Draft 평가)
  finalResult.innerHTML = `
    <h3>Evaluation Results</h3>
    <p><strong>Idea Score:</strong> ${ideaScore !== null ? ideaScore : "N/A"}</p>
    <p><strong>Structure Score:</strong> ${structureScore !== null ? structureScore : "N/A"}</p>
    <p><strong>Accuracy Score:</strong> ${accuracyScore !== null ? accuracyScore : "N/A"}</p>
    <hr />
    <h3>Feedback</h3>
    <p>${feedbackText}</p>
    <hr />
  `;

  // 1) Worker Proxy로 DALL-E-2 이미지 생성 요청    
  const response = await fetch(WORKER_PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "dall-e-2",
      type: "image_generation",
      prompt: `A storybook illustration of ${finalContent}, watercolor style with soft lighting, child-friendly vibrant colors`,
      n: 1,
      size: "512x512",
    }),
  });

  if (!response.ok) {
    const errorMsg = await response.text();
    throw new Error("이미지 생성 API 에러: " + errorMsg);
  }

  // 2) 이미지 URL 파싱
  const data = await response.json();
  const imageUrl = data?.data?.[0]?.url;
  if (!imageUrl) {
    throw new Error("이미지 URL이 존재하지 않습니다.");
  }

  // 3) "My Portfolio" 섹션 추가 및 이미지 + Final Draft 배치
  const portfolioSection = document.createElement("div");
  portfolioSection.innerHTML = `
    <h3>My Portfolio</h3>
    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
      <img src="${imageUrl}" alt="Generated Image" style="max-width: 300px; border: 1px solid #ccc;" />
      <p style="flex: 1;">${finalContent}</p>
    </div>
    <hr />
  `;

  finalResult.appendChild(portfolioSection);

  // 스크롤/포커스
  finalResult.scrollIntoView({ behavior: "smooth" });
  finalResult.setAttribute("tabindex", "-1");
  finalResult.focus();

} catch (err) {
  console.error(err);
  finalResult.textContent = "에러 발생: " + err.message;
}
});
