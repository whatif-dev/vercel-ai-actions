import "server-only";

import dedent from "dedent";
import { createAI, createStreamableUI, getMutableAIState } from "ai/rsc";
import OpenAI from "openai";

import { spinner, BotMessage, SystemMessage } from "@/components/llm-stocks";

import { runOpenAICompletion } from "@/lib/utils";
import { setupFunctionCalling } from "ai-actions";
import { TStreamableActionId } from "@/ai/streamable-ui-registry/types";
import { AI } from "@/ai";
import { StreamableActionsRegistry } from "@/ai/streamable-ui-registry";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

export async function submitUserMessageStreamable(
  content: string,
  actionIds?: TStreamableActionId[]
) {
  "use server";

  const aiState = getMutableAIState<typeof AI>();
  aiState.update([
    ...aiState.get(),
    {
      role: "user",
      content,
    },
  ]);

  const reply = createStreamableUI(
    <BotMessage className="items-center">{spinner}</BotMessage>
  );

  const { functions, functionCallHandler } = setupFunctionCalling(
    StreamableActionsRegistry,
    {
      inArray: actionIds,
      context: {
        reply,
        aiState,
      },
    }
  );

  const completion = runOpenAICompletion(openai, functionCallHandler, {
    model: "gpt-3.5-turbo",
    stream: true,
    messages: [
      {
        role: "system",
        content: dedent`
          You are a stock trading conversation bot and you can help users buy stocks, step by step.
          You and the user can discuss stock prices and the user can adjust the amount of stocks they want to buy, or place an order, in the UI.

          Messages inside [] means that it's a UI element or a user event. For example:
          - "[Price of AAPL = 100]" means that an interface of the stock price of AAPL is shown to the user.
          - "[User has changed the amount of AAPL to 10]" means that the user has changed the amount of AAPL to 10 in the UI.

          Instructions:
          ${functions.map((fn) => `${StreamableActionsRegistry[fn.name as TStreamableActionId].getMetadata().systemMessage}`).join("\n")}
          If the user wants to sell stock, or complete another impossible task, respond that you are a demo and cannot do that.

          Besides that, you can also chat with users and do some calculations if needed.`,
      },
      ...aiState.get().map((info: any) => ({
        role: info.role,
        content: info.content,
        name: info.name,
      })),
    ],
    functions,
    temperature: 0,
  });

  completion.onTextContent((content: string, isFinal: boolean) => {
    reply.update(<BotMessage>{content}</BotMessage>);
    if (isFinal) {
      reply.done();
      aiState.done([...aiState.get(), { role: "assistant", content }]);
    }
  });

  return {
    id: Date.now(),
    display: reply.value,
  };
}
