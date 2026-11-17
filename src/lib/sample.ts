import { lessonSchema } from "./lesson";

// An explicitly labeled example, never returned as a substitute for a live AI request.
export const sampleLesson = lessonSchema.parse({
  version: 1,
  id: "sample-photosynthesis-v1",
  topic: "How photosynthesis works",
  source: "sample",
  content: {
    title: "How leaves turn sunlight into food",
    summary:
      "Follow the energy from the sun to a leaf, and discover how plants make the food that supports life.",
    scenes: [
      {
        id: "idea",
        title: "A leaf is a tiny food factory",
        layout: "flow",
        nodes: [
          { id: "sun", label: "Sunlight", detail: "The energy source", kind: "concept" },
          { id: "leaf", label: "A green leaf", detail: "Captures light energy", kind: "concept" },
          { id: "food", label: "Sugar", detail: "Stores chemical energy", kind: "concept" },
        ],
        connections: [
          { from: "sun", to: "leaf", label: "light energy" },
          { from: "leaf", to: "food", label: "stored as" },
        ],
        points: [],
        xLabel: "",
        yLabel: "",
      },
      {
        id: "ingredients",
        title: "What goes into the leaf?",
        layout: "flow",
        nodes: [
          { id: "water", label: "Water", detail: "Absorbed by the roots", kind: "concept" },
          { id: "carbon", label: "Carbon dioxide", detail: "Enters from the air", kind: "concept" },
          {
            id: "chloroplast",
            label: "Chloroplast",
            detail: "Where photosynthesis happens",
            kind: "concept",
          },
        ],
        connections: [
          { from: "water", to: "chloroplast", label: "from roots" },
          { from: "carbon", to: "chloroplast", label: "from air" },
        ],
        points: [],
        xLabel: "",
        yLabel: "",
      },
      {
        id: "outputs",
        title: "Energy changes form",
        layout: "comparison",
        nodes: [
          {
            id: "sugar",
            label: "Sugar for the plant",
            detail: "Energy for growth and repair",
            kind: "concept",
          },
          {
            id: "oxygen",
            label: "Oxygen for the air",
            detail: "Released during the process",
            kind: "concept",
          },
        ],
        connections: [],
        points: [],
        xLabel: "",
        yLabel: "",
      },
      {
        id: "recap",
        title: "Put the whole picture together",
        layout: "flow",
        nodes: [
          {
            id: "inputs",
            label: "Water + carbon dioxide",
            detail: "The raw ingredients",
            kind: "concept",
          },
          {
            id: "process",
            label: "Light-powered change",
            detail: "Inside chloroplasts",
            kind: "concept",
          },
          {
            id: "results",
            label: "Sugar + oxygen",
            detail: "Food stored, oxygen released",
            kind: "concept",
          },
        ],
        connections: [
          { from: "inputs", to: "process", label: "using sunlight" },
          { from: "process", to: "results", label: "produces" },
        ],
        points: [],
        xLabel: "",
        yLabel: "",
      },
    ],
    steps: [
      {
        sceneId: "idea",
        narration:
          "Imagine a leaf as a tiny food factory. Unlike us, a plant does not need to eat a meal to get its food.",
        reveal: ["sun"],
        highlight: ["sun"],
      },
      {
        sceneId: "idea",
        narration:
          "Instead, its green leaves capture energy from sunlight. The green pigment that helps absorb this light is called chlorophyll, found inside leaf cells.",
        reveal: ["leaf"],
        highlight: ["leaf"],
      },
      {
        sceneId: "idea",
        narration:
          "That captured energy helps the plant make sugar. Sugar stores chemical energy that the plant can use later, even when the sun is gone.",
        reveal: ["food"],
        highlight: ["food"],
      },
      {
        sceneId: "ingredients",
        narration:
          "A factory needs ingredients. The plant takes up water through its roots, and this water travels through its stem into the leaves.",
        reveal: ["water"],
        highlight: ["water"],
      },
      {
        sceneId: "ingredients",
        narration:
          "The other main ingredient is carbon dioxide, a gas in the air. It enters the leaf through tiny openings known as stomata.",
        reveal: ["carbon"],
        highlight: ["carbon"],
      },
      {
        sceneId: "ingredients",
        narration:
          "Inside each leaf cell are chloroplasts. These structures use light energy to support the reactions that turn water and carbon dioxide into sugar.",
        reveal: ["chloroplast"],
        highlight: ["chloroplast"],
      },
      {
        sceneId: "outputs",
        narration:
          "Think of a growing seedling. The sugar it makes supplies material for growth, and can be broken down in respiration to release usable energy.",
        reveal: ["sugar"],
        highlight: ["sugar"],
      },
      {
        sceneId: "outputs",
        narration:
          "Oxygen is also released during photosynthesis. This oxygen comes from water molecules, and some of it leaves the plant and enters the air.",
        reveal: ["oxygen"],
        highlight: ["oxygen"],
      },
      {
        sceneId: "outputs",
        narration:
          "Notice the two different results. The plant stores energy in sugar, while the oxygen it releases supports the breathing of many living things.",
        reveal: [],
        highlight: ["sugar", "oxygen"],
      },
      {
        sceneId: "recap",
        narration:
          "Let us connect the whole picture. Water from the soil and carbon dioxide from the air are the ingredients that enter the process.",
        reveal: ["inputs"],
        highlight: ["inputs"],
      },
      {
        sceneId: "recap",
        narration:
          "Sunlight provides the energy for this change inside chloroplasts. Light is an energy source, rather than an ingredient that becomes part of the sugar.",
        reveal: ["process"],
        highlight: ["process"],
      },
      {
        sceneId: "recap",
        narration:
          "The results are sugar and oxygen. Remember the key idea: photosynthesis changes light energy into chemical energy, helping support entire food chains.",
        reveal: ["results"],
        highlight: ["results"],
      },
    ],
    check: {
      question: "Where does the energy stored in a plant’s sugar originally come from?",
      choices: ["Sunlight", "Minerals in the soil", "Oxygen in the air"],
      correctIndex: 0,
      explanation:
        "Sunlight supplies the energy. Photosynthesis stores that energy in sugar; water and carbon dioxide provide the raw ingredients.",
    },
  },
});
