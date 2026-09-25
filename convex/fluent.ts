import { getAuthUserId } from "@convex-dev/auth/server";
import type { Auth, GenericDatabaseReader } from "convex/server";
import { ConvexError, v, type PropertyValidators } from "convex/values";
import {
  ConvexBuilderWithFunctionKind,
  createBuilder,
  type Context,
  type ConvexArgsValidator,
  type ConvexBuilderDef,
  type ConvexMiddleware,
  type ConvexReturnsValidator,
  type EmptyObject,
  type FunctionType,
} from "fluent-convex";
import type { DataModel } from "./_generated/dataModel";
import { tokensMatch } from "./lib/tokens";

export const convex = createBuilder<DataModel>();

// Public functions deliberately carry no authorization. Keep them small and
// return explicit projections only.
export const publicQuery = convex.query();

// ---------- Kiosk device ----------

// The wall display has no signed-in user. Every kiosk call carries the shared
// device token, which only exists in Convex and in the kiosk build on the Pi.
const deviceTokenArgs = { deviceToken: v.string() };
type DeviceTokenArgs = typeof deviceTokenArgs;

export function isDeviceTokenValid(deviceToken: unknown) {
  const expected = process.env.CANNVAS_DEVICE_TOKEN?.trim();
  return typeof deviceToken === "string" && !!expected && tokensMatch(deviceToken, expected);
}

function requireDeviceToken(args: unknown) {
  const deviceToken = (args as { deviceToken?: unknown } | undefined)?.deviceToken;
  if (!isDeviceTokenValid(deviceToken)) throw new ConvexError("This device is not authorized.");
  return args;
}

// Middleware cannot see arguments, so the device check is a small plugin in
// the same style as fluent-convex/zod: it adds `deviceToken` to every input
// validator and rejects the call before any middleware or handler runs.
export class WithDeviceToken<
  TDataModel extends DataModel = DataModel,
  TFunctionType extends FunctionType = FunctionType,
  TCurrentContext extends Context = EmptyObject,
  TArgsValidator extends ConvexArgsValidator | undefined = undefined,
  TReturnsValidator extends ConvexReturnsValidator | undefined = undefined,
> extends ConvexBuilderWithFunctionKind<
  TDataModel,
  TFunctionType,
  TCurrentContext,
  TArgsValidator,
  TReturnsValidator
> {
  constructor(
    builderOrDef:
      | ConvexBuilderWithFunctionKind<
          TDataModel,
          TFunctionType,
          TCurrentContext,
          TArgsValidator,
          TReturnsValidator
        >
      | ConvexBuilderDef<TFunctionType, TArgsValidator, TReturnsValidator>,
  ) {
    const def: ConvexBuilderDef<TFunctionType, TArgsValidator, TReturnsValidator> =
      builderOrDef instanceof ConvexBuilderWithFunctionKind
        ? (builderOrDef as unknown as { def: ConvexBuilderDef<TFunctionType, TArgsValidator, TReturnsValidator> }).def
        : builderOrDef;
    super({
      ...def,
      argsValidator: { ...(def.argsValidator as PropertyValidators | undefined), ...deviceTokenArgs } as never,
      argsTransform: requireDeviceToken,
    });
  }

  protected _clone(def: ConvexBuilderDef<any, any, any>): any {
    return new WithDeviceToken(def);
  }

  // @ts-ignore -- narrows the return type from the base builder to WithDeviceToken
  use<UOutContext extends Context>(
    middleware: ConvexMiddleware<TCurrentContext, UOutContext>,
  ): WithDeviceToken<
    TDataModel,
    TFunctionType,
    TCurrentContext & UOutContext,
    TArgsValidator,
    TReturnsValidator
  > {
    return super.use(middleware) as any;
  }

  // @ts-ignore -- only plain property validators can be merged with the token
  input<UInput extends PropertyValidators>(
    validator: UInput,
  ): WithDeviceToken<
    TDataModel,
    TFunctionType,
    TCurrentContext,
    UInput & DeviceTokenArgs,
    TReturnsValidator
  > {
    return this._clone({ ...this.def, argsValidator: validator });
  }

  // @ts-ignore -- narrows the return type from the base builder to WithDeviceToken
  returns<UReturns extends ConvexReturnsValidator>(
    validator: UReturns,
  ): WithDeviceToken<TDataModel, TFunctionType, TCurrentContext, TArgsValidator, UReturns> {
    return super.returns(validator) as any;
  }
}

export const deviceQuery = convex.query().extend(WithDeviceToken);
export const deviceMutation = convex.mutation().extend(WithDeviceToken);
export const deviceAction = convex.action().extend(WithDeviceToken);

// ---------- Inventory ----------

export async function getInventoryAccess(db: GenericDatabaseReader<DataModel>, userId: DataModel["users"]["document"]["_id"]) {
  return await db
    .query("inventoryAccess")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .unique();
}

// Anyone can create a password account, so a signed-in user is not enough.
// Inventory also needs an inventoryAccess row granted from the CLI.
const inventoryUserMiddleware = convex
  .$context<{ auth: Auth; db: GenericDatabaseReader<DataModel> }>()
  .createMiddleware(async (ctx, next) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("You need to sign in to use the inventory.");
    const access = await getInventoryAccess(ctx.db, userId);
    if (!access) throw new ConvexError("This account does not have inventory access.");
    return next({ ...ctx, userId, inventoryRole: access.role });
  });

export const inventoryQuery = convex.query().use(inventoryUserMiddleware);
export const inventoryMutation = convex.mutation().use(inventoryUserMiddleware);
