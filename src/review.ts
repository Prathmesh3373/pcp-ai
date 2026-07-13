import {
  confirm,
  input,
  select,
} from "@inquirer/prompts";

import type {
  AnalyzerResult,
  ExtractedContextItem,
} from "./analyzer.js";

export interface ReviewedContextItem extends ExtractedContextItem {
  reviewStatus: "approved" | "rejected";
}

export async function reviewContextItems(
  result: AnalyzerResult,
): Promise<ReviewedContextItem[]> {
  if (result.items.length === 0) {
    return [];
  }

  console.log("\n========================================");
  console.log(" Review extracted context");
  console.log("========================================\n");

  console.log(
    `PCP extracted ${result.items.length} possible context item${
      result.items.length === 1 ? "" : "s"
    }.\n`,
  );

  const bulkAction = await select<
    "review" | "approve_all" | "reject_all"
  >({
    message: "How would you like to review them?",
    choices: [
      {
        name: "Review each item individually",
        value: "review",
      },
      {
        name: "Approve all items",
        value: "approve_all",
      },
      {
        name: "Reject all items",
        value: "reject_all",
      },
    ],
  });

  if (bulkAction === "approve_all") {
    return result.items.map((item) => ({
      ...item,
      reviewStatus: "approved",
    }));
  }

  if (bulkAction === "reject_all") {
    return result.items.map((item) => ({
      ...item,
      reviewStatus: "rejected",
    }));
  }

  const reviewedItems: ReviewedContextItem[] = [];

  for (const [index, item] of result.items.entries()) {
    console.log("\n----------------------------------------");
    console.log(`Item ${index + 1} of ${result.items.length}`);
    console.log("----------------------------------------");

    console.log(`Value: ${item.value}`);
    console.log(`Category: ${item.category}`);
    console.log(`Evidence: ${item.evidence}`);
    console.log(`Confidence: ${formatConfidence(item.confidence)}`);
    console.log(`Sensitivity: ${item.sensitivity}`);
    console.log(`Workspace: ${item.workspaceId}\n`);

    const action = await select<
      "approve" | "edit" | "reject"
    >({
      message: "What should PCP do with this item?",
      choices: [
        {
          name: "Approve",
          value: "approve",
        },
        {
          name: "Edit before approving",
          value: "edit",
        },
        {
          name: "Reject",
          value: "reject",
        },
      ],
    });

    if (action === "reject") {
      reviewedItems.push({
        ...item,
        reviewStatus: "rejected",
      });

      continue;
    }

    if (action === "approve") {
      reviewedItems.push({
        ...item,
        reviewStatus: "approved",
      });

      continue;
    }

    const editedItem = await editContextItem(item);

    reviewedItems.push({
      ...editedItem,
      reviewStatus: "approved",
    });
  }

  return reviewedItems;
}

async function editContextItem(
  item: ExtractedContextItem,
): Promise<ExtractedContextItem> {
  const value = await input({
    message: "Edit the context value:",
    default: item.value,
    validate(inputValue) {
      return (
        inputValue.trim().length >= 3 ||
        "Context value must contain at least 3 characters."
      );
    },
  });

  const evidence = await input({
    message: "Edit the evidence:",
    default: item.evidence,
    validate(inputValue) {
      return (
        inputValue.trim().length >= 3 ||
        "Evidence must contain at least 3 characters."
      );
    },
  });

  const keepExistingMetadata = await confirm({
    message:
      "Keep the existing category, confidence, sensitivity, and workspace?",
    default: true,
  });

  if (keepExistingMetadata) {
    return {
      ...item,
      value: value.trim(),
      evidence: evidence.trim(),
    };
  }

  const category = await select<
    ExtractedContextItem["category"]
  >({
    message: "Choose the context category:",
    default: item.category,
    choices: [
      {
        name: "Identity",
        value: "identity",
      },
      {
        name: "Goal",
        value: "goal",
      },
      {
        name: "Interest",
        value: "interest",
      },
      {
        name: "Experience",
        value: "experience",
      },
      {
        name: "Project",
        value: "project",
      },
      {
        name: "Work style",
        value: "work_style",
      },
      {
        name: "Learning style",
        value: "learning_style",
      },
      {
        name: "Constraint",
        value: "constraint",
      },
      {
        name: "Principle",
        value: "principle",
      },
      {
        name: "Other",
        value: "other",
      },
    ],
  });

  const sensitivity = await select<
    ExtractedContextItem["sensitivity"]
  >({
    message: "Choose the sensitivity:",
    default: item.sensitivity,
    choices: [
      {
        name: "Public",
        value: "public",
      },
      {
        name: "Personal",
        value: "personal",
      },
      {
        name: "Sensitive",
        value: "sensitive",
      },
    ],
  });

  const workspaceId = await input({
    message: "Workspace ID:",
    default: item.workspaceId,
    validate(inputValue) {
      return (
        inputValue.trim().length > 0 ||
        "Workspace ID is required."
      );
    },
  });

  const confidenceText = await input({
    message: "Confidence between 0 and 1:",
    default: String(item.confidence),
    validate(inputValue) {
      const confidence = Number(inputValue);

      if (
        Number.isNaN(confidence) ||
        confidence < 0 ||
        confidence > 1
      ) {
        return "Confidence must be a number between 0 and 1.";
      }

      return true;
    },
  });

  return {
    ...item,
    value: value.trim(),
    evidence: evidence.trim(),
    category,
    sensitivity,
    workspaceId: workspaceId.trim(),
    confidence: Number(confidenceText),
  };
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}