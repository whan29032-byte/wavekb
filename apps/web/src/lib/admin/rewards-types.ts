export type AdminRewardProduct = {
  id: string;
  name: string;
  summary: string;
  description: string;
  image_url: string | null;
  category: "identity" | "digital" | "service" | "physical";
  product_type: "nameplate" | "title" | "digital" | "service" | "physical";
  price_points: number;
  stock: number;
  metadata: Record<string, unknown>;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type AdminRewardWallet = {
  user_id: string;
  public_uid: number | null;
  display_name: string;
  bio: string;
  display_title: string | null;
  nameplate_style: string;
  balance: number;
  lifetime_earned: number;
  updated_at: string;
};

export type AdminRewardRedemption = {
  id: string;
  user_id: string;
  public_uid: number | null;
  display_name: string;
  product_id: string;
  product_name: string;
  quantity: number;
  points_spent: number;
  status: "pending" | "fulfilled" | "cancelled" | "refunded";
  fulfillment_note: string;
  created_at: string;
};

export type AdminNameplateEntitlement = {
  id: string;
  user_id: string;
  public_uid: number | null;
  display_name: string;
  product_id: string;
  product_name: string;
  style: string;
  starts_at: string;
  expires_at: string;
  equipped: boolean;
  source: "admin_grant" | "redeemed" | string;
};

export type AdminRewardStore = {
  products: AdminRewardProduct[];
  wallets: AdminRewardWallet[];
  redemptions: AdminRewardRedemption[];
  entitlements: AdminNameplateEntitlement[];
};

export type RewardProductInput = {
  id?: string | null;
  name: string;
  summary: string;
  description: string;
  imageUrl?: string | null;
  category: AdminRewardProduct["category"];
  productType: AdminRewardProduct["product_type"];
  pricePoints: number;
  stock: number;
  metadata: Record<string, unknown>;
  active: boolean;
  sortOrder: number;
};
