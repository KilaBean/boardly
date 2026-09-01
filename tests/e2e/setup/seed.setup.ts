import { test as setup } from "@playwright/test";

import { ACCOUNTS, SEED, TEST_PASSWORD } from "../helpers/accounts";
import { loadEnvLocal } from "../helpers/env";
import {
  addBoardMember,
  addWorkspaceMember,
  createBoard,
  createConfirmedUser,
  createWorkspace,
  deleteUserByEmail,
} from "../helpers/seed";

loadEnvLocal();

/**
 * Arranges the world the authenticated tests run against.
 *
 * Runs once, before any browser opens. Every helper is idempotent, so a
 * re-run starts from a known state rather than colliding with leftovers from
 * the previous run — which matters because a failed run leaves data behind.
 */
setup("seed database", async () => {
  // Order matters: the outsider owns nothing, but the other two do, and
  // workspaces use ON DELETE RESTRICT on owner_id.
  await deleteUserByEmail(ACCOUNTS.outsider.email);
  await deleteUserByEmail(ACCOUNTS.quitter.email);
  await deleteUserByEmail(ACCOUNTS.resetter.email);

  const owner = await createConfirmedUser(
    ACCOUNTS.owner.email,
    TEST_PASSWORD,
    ACCOUNTS.owner.displayName,
  );
  const collaborator = await createConfirmedUser(
    ACCOUNTS.collaborator.email,
    TEST_PASSWORD,
    ACCOUNTS.collaborator.displayName,
  );
  await createConfirmedUser(ACCOUNTS.outsider.email, TEST_PASSWORD, ACCOUNTS.outsider.displayName);
  const quitter = await createConfirmedUser(
    ACCOUNTS.quitter.email,
    TEST_PASSWORD,
    ACCOUNTS.quitter.displayName,
  );
  const resetter = await createConfirmedUser(
    ACCOUNTS.resetter.email,
    TEST_PASSWORD,
    ACCOUNTS.resetter.displayName,
  );

  const workspace = await createWorkspace(owner.id, SEED.workspace.name, SEED.workspace.slug);
  await addWorkspaceMember(workspace.id, collaborator.id, "member");
  // Needs a workspace so signing out has somewhere to sign back in to.
  await addWorkspaceMember(workspace.id, quitter.id, "member");
  // Needs a workspace so a successful reset lands on a board list, not onboarding.
  await addWorkspaceMember(workspace.id, resetter.id, "member");

  // Visible to the whole workspace.
  await createBoard(workspace.id, owner.id, SEED.sharedBoard, "workspace");

  // Private to the owner. The collaborator is a workspace member but has no
  // explicit grant, so this board must stay invisible to them.
  const privateBoard = await createBoard(workspace.id, owner.id, SEED.privateBoard, "private");

  // A third board proving explicit viewer access overrides the workspace
  // default: the collaborator can open it but must not be able to edit.
  const viewerBoard = await createBoard(workspace.id, owner.id, "Read Only For Casey", "private");
  await addBoardMember(viewerBoard.id, collaborator.id, "viewer");

  void privateBoard;
});
