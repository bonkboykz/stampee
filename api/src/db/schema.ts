import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  jsonb,
  timestamp,
  date,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Users — replaces auth.users. Owns auth secret + identity.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  emailVerified: boolean('email_verified').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Profiles — business / staff profile attached to a user.
export const profiles = pgTable('profiles', {
  id: uuid('id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  businessName: text('business_name').notNull(),
  email: text('email').notNull(),
  slug: text('slug').unique(),
  role: text('role').notNull().default('owner'),
  ownerId: uuid('owner_id').references((): any => profiles.id, {
    onDelete: 'cascade',
  }),
  status: text('status').notNull().default('verified'),
  access: text('access').notNull().default('active'),
  tier: text('tier').notNull().default('free'),
  tierExpiresAt: timestamp('tier_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const campaigns = pgTable('campaigns', {
  id: text('id')
    .primaryKey()
    .default(sql`gen_random_uuid()::text`),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isEnabled: boolean('is_enabled').notNull().default(true),
  description: text('description').notNull().default(''),
  rewardName: text('reward_name').notNull().default(''),
  tagline: text('tagline'),
  backgroundImage: text('background_image'),
  backgroundOpacity: integer('background_opacity').default(100),
  logoImage: text('logo_image'),
  showLogo: boolean('show_logo').default(true),
  titleSize: text('title_size'),
  iconKey: text('icon_key').notNull().default('Coffee'),
  colors: jsonb('colors').notNull(),
  totalStamps: integer('total_stamps').notNull().default(10),
  social: jsonb('social'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const customers = pgTable('customers', {
  id: text('id')
    .primaryKey()
    .default(sql`gen_random_uuid()::text`),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email').notNull(),
  mobile: text('mobile'),
  status: text('status').notNull().default('Active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const issuedCards = pgTable('issued_cards', {
  id: text('id')
    .primaryKey()
    .default(sql`gen_random_uuid()::text`),
  uniqueId: uuid('unique_id').notNull().defaultRandom().unique(),
  customerId: text('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'cascade' }),
  campaignId: text('campaign_id').references(() => campaigns.id, {
    onDelete: 'set null',
  }),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  campaignName: text('campaign_name').notNull(),
  stamps: integer('stamps').notNull().default(0),
  lastVisit: date('last_visit').notNull().defaultNow(),
  status: text('status').notNull().default('Active'),
  completedDate: date('completed_date'),
  templateSnapshot: jsonb('template_snapshot'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable('transactions', {
  id: text('id')
    .primaryKey()
    .default(sql`gen_random_uuid()::text`),
  cardId: text('card_id')
    .notNull()
    .references(() => issuedCards.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  amount: integer('amount').notNull().default(0),
  date: text('date').notNull(),
  timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
  title: text('title').notNull(),
  remarks: text('remarks'),
  actorId: uuid('actor_id'),
  actorName: text('actor_name'),
  actorRole: text('actor_role'),
});

export const licenseKeys = pgTable('license_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').references(() => profiles.id, {
    onDelete: 'set null',
  }),
  licenseKey: text('license_key').notNull().unique(),
  platform: text('platform').notNull().default('gumroad'),
  status: text('status').notNull().default('active'),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Staff PIN credentials live separate from users.password_hash so an owner can
// reset PINs without touching the user's bcrypt password.
export const staffCredentials = pgTable('staff_credentials', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  pinHash: text('pin_hash').notNull(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const profilesSlugIdx = uniqueIndex('profiles_slug_lower_idx');
