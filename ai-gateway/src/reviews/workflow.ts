import { randomUUID } from "node:crypto";

type ReviewStatus = "draft" | "ai_reviewed" | "human_approved" | "published_experience" | "rejected";
type Review = {
  id: string;
  runId: string;
  summary: unknown;
  ownerId: string;
  status: ReviewStatus;
  audit: Array<{ from: ReviewStatus; to: ReviewStatus; actor: string; reason: string; at: string }>;
};

export class ReviewWorkflow {
  private readonly reviews = new Map<string, Review>();
  private readonly publishToIndex: (reviewId: string) => void;
  constructor(publishToIndex: (reviewId: string) => void) {
    this.publishToIndex = publishToIndex;
  }

  propose(runId: string, summary: unknown, ownerId: string): Review {
    const review: Review = {
      id: randomUUID(), runId, summary, ownerId, status: "draft", audit: [],
    };
    this.reviews.set(review.id, review);
    return review;
  }

  private transition(id: string, to: ReviewStatus, actor: string, reason: string): Review {
    const review = this.reviews.get(id);
    if (!review) throw new Error("review not found");
    const allowed: Record<ReviewStatus, ReviewStatus[]> = {
      draft: ["ai_reviewed", "rejected"],
      ai_reviewed: ["human_approved", "rejected"],
      human_approved: ["published_experience", "rejected"],
      published_experience: [],
      rejected: [],
    };
    if (!allowed[review.status].includes(to)) {
      throw new Error(`invalid review transition ${review.status} -> ${to}`);
    }
    const from = review.status;
    review.status = to;
    review.audit.push({ from, to, actor, reason, at: new Date().toISOString() });
    if (to === "published_experience") this.publishToIndex(review.id);
    return review;
  }

  markAiReviewed(id: string, actor: string): Review {
    return this.transition(id, "ai_reviewed", actor, "AI review complete");
  }
  approve(id: string, actor: string, reason: string): Review {
    if (!reason.trim()) throw new Error("approval reason required");
    return this.transition(id, "human_approved", actor, reason);
  }
  publish(id: string, actor: string): Review {
    return this.transition(id, "published_experience", actor, "published");
  }
  reject(id: string, actor: string, reason: string): Review {
    return this.transition(id, "rejected", actor, reason);
  }
}
