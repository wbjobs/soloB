#include "PhysicsEngine.h"
#include <random>

namespace Physics {

Game::Game()
    : window(nullptr)
    , renderer(nullptr)
    , isRunning(false)
    , world(nullptr)
    , isDragging(false)
    , draggedBody(nullptr)
    , dragOffset(Vector2(0, 0))
    , lastMousePos(Vector2(0, 0))
{
}

Game::~Game() {
    Cleanup();
}

bool Game::Initialize(const char* title, int width, int height) {
    if (SDL_Init(SDL_INIT_VIDEO) < 0) {
        SDL_Log("SDL 初始化失败: %s", SDL_GetError());
        return false;
    }

    window = SDL_CreateWindow(
        title,
        SDL_WINDOWPOS_CENTERED,
        SDL_WINDOWPOS_CENTERED,
        width,
        height,
        SDL_WINDOW_SHOWN
    );

    if (!window) {
        SDL_Log("创建窗口失败: %s", SDL_GetError());
        SDL_Quit();
        return false;
    }

    renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC);
    if (!renderer) {
        SDL_Log("创建渲染器失败: %s", SDL_GetError());
        SDL_DestroyWindow(window);
        SDL_Quit();
        return false;
    }

    world = std::make_unique<PhysicsWorld>(Vector2(0.0f, 500.0f));

    world->AddStaticBox(static_cast<float>(width), 30.0f, static_cast<float>(width) / 2.0f, static_cast<float>(height) - 15.0f);
    world->AddStaticBox(30.0f, static_cast<float>(height), 15.0f, static_cast<float>(height) / 2.0f);
    world->AddStaticBox(30.0f, static_cast<float>(height), static_cast<float>(width) - 15.0f, static_cast<float>(height) / 2.0f);

    world->AddStaticBox(200.0f, 30.0f, 300.0f, static_cast<float>(height) - 150.0f);
    world->AddStaticBox(200.0f, 30.0f, 600.0f, static_cast<float>(height) - 250.0f);

    auto demoCloth = std::make_unique<Cloth>();
    demoCloth->Initialize(
        450.0f, 80.0f,
        15, 12,
        20.0f,
        0.3f,
        600.0f,
        true
    );
    demoCloth->SetColor({100, 200, 255, 255});
    cloths.push_back(std::move(demoCloth));

    isRunning = true;
    return true;
}

void Game::HandleEvents() {
    SDL_Event event;

    while (SDL_PollEvent(&event)) {
        switch (event.type) {
            case SDL_QUIT:
                isRunning = false;
                break;

            case SDL_MOUSEBUTTONDOWN: {
                Vector2 mousePos(static_cast<float>(event.button.x), static_cast<float>(event.button.y));

                if (event.button.button == SDL_BUTTON_LEFT) {
                    bool clothDragged = false;
                    for (auto it = cloths.rbegin(); it != cloths.rend(); ++it) {
                        if ((*it)->TryStartDrag(mousePos)) {
                            clothDragInfo.isDragging = true;
                            clothDragInfo.mass = (*it)->GetPointAt(mousePos, 20.0f);
                            clothDragged = true;
                            break;
                        }
                    }

                    if (!clothDragged) {
                        RigidBody* body = world->GetBodyAtPoint(mousePos);

                        if (body && !body->isStatic) {
                            isDragging = true;
                            draggedBody = body;
                            dragOffset = body->position - mousePos;
                            lastMousePos = mousePos;
                            body->velocity = Vector2(0, 0);
                            body->SetStatic(true);
                        } else {
                            SpawnRandomBody(mousePos);
                        }
                    }
                } else if (event.button.button == SDL_BUTTON_RIGHT) {
                    SpawnCloth(mousePos);
                }
                break;
            }

            case SDL_MOUSEBUTTONUP: {
                if (event.button.button == SDL_BUTTON_LEFT) {
                    if (clothDragInfo.isDragging) {
                        for (auto& cloth : cloths) {
                            cloth->EndDrag();
                        }
                        clothDragInfo.isDragging = false;
                        clothDragInfo.mass = nullptr;
                    }

                    if (isDragging && draggedBody) {
                        Vector2 mousePos(static_cast<float>(event.button.x), static_cast<float>(event.button.y));
                        Vector2 delta = mousePos - lastMousePos;
                        draggedBody->SetStatic(false);
                        draggedBody->velocity = delta * 10.0f;
                        isDragging = false;
                        draggedBody = nullptr;
                    }
                }
                break;
            }

            case SDL_MOUSEMOTION: {
                Vector2 mousePos(static_cast<float>(event.motion.x), static_cast<float>(event.motion.y));

                if (clothDragInfo.isDragging) {
                    for (auto& cloth : cloths) {
                        cloth->UpdateDrag(mousePos);
                    }
                }

                if (isDragging && draggedBody) {
                    draggedBody->SetPosition(mousePos + dragOffset);
                    lastMousePos = mousePos;
                }
                break;
            }

            case SDL_KEYDOWN: {
                if (event.key.keysym.sym == SDLK_SPACE) {
                    world->Clear();
                    cloths.clear();

                    int w, h;
                    SDL_GetWindowSize(window, &w, &h);

                    world->AddStaticBox(static_cast<float>(w), 30.0f, static_cast<float>(w) / 2.0f, static_cast<float>(h) - 15.0f);
                    world->AddStaticBox(30.0f, static_cast<float>(h), 15.0f, static_cast<float>(h) / 2.0f);
                    world->AddStaticBox(30.0f, static_cast<float>(h), static_cast<float>(w) - 15.0f, static_cast<float>(h) / 2.0f);

                    world->AddStaticBox(200.0f, 30.0f, 300.0f, static_cast<float>(h) - 150.0f);
                    world->AddStaticBox(200.0f, 30.0f, 600.0f, static_cast<float>(h) - 250.0f);

                    auto demoCloth = std::make_unique<Cloth>();
                    demoCloth->Initialize(
                        static_cast<float>(w) / 2.0f, 80.0f,
                        15, 12,
                        20.0f,
                        0.3f,
                        600.0f,
                        true
                    );
                    demoCloth->SetColor({100, 200, 255, 255});
                    cloths.push_back(std::move(demoCloth));
                }
                break;
            }

            default:
                break;
        }
    }
}

void Game::SpawnRandomBody(const Vector2& pos) {
    static std::random_device rd;
    static std::mt19937 gen(rd());
    static std::uniform_int_distribution<int> typeDist(0, 1);
    static std::uniform_real_distribution<float> sizeDist(20.0f, 60.0f);

    int type = typeDist(gen);

    if (type == 0) {
        float size = sizeDist(gen);
        world->AddBox(size, size, pos.x, pos.y, 1.0f);
    } else {
        float radius = sizeDist(gen) * 0.5f;
        world->AddCircle(radius, pos.x, pos.y, 1.0f);
    }
}

void Game::SpawnCloth(const Vector2& pos) {
    static std::random_device rd;
    static std::mt19937 gen(rd());
    static std::uniform_int_distribution<int> sizeDist(8, 15);
    static std::uniform_int_distribution<int> colorDist(80, 220);

    int cols = sizeDist(gen);
    int rows = sizeDist(gen);

    auto cloth = std::make_unique<Cloth>();
    cloth->Initialize(
        pos.x, pos.y,
        cols, rows,
        18.0f,
        0.3f,
        500.0f,
        true
    );

    SDL_Color color = {
        static_cast<Uint8>(colorDist(gen)),
        static_cast<Uint8>(colorDist(gen)),
        static_cast<Uint8>(colorDist(gen)),
        255
    };
    cloth->SetColor(color);

    cloths.push_back(std::move(cloth));
}

void Game::Render() {
    SDL_SetRenderDrawColor(renderer, 30, 30, 30, 255);
    SDL_RenderClear(renderer);

    for (const auto& body : world->GetBodies()) {
        body->Draw(renderer);
    }

    for (const auto& cloth : cloths) {
        cloth->Draw(renderer);
    }

    SDL_RenderPresent(renderer);
}

void Game::Run() {
    const float dt = 1.0f / 60.0f;
    Uint32 lastTime = SDL_GetTicks();
    float accumulator = 0.0f;

    Vector2 clothGravity(0.0f, 400.0f);

    while (isRunning) {
        Uint32 currentTime = SDL_GetTicks();
        float frameTime = static_cast<float>(currentTime - lastTime) / 1000.0f;
        if (frameTime > 0.25f) frameTime = 0.25f;
        lastTime = currentTime;

        accumulator += frameTime;

        HandleEvents();

        while (accumulator >= dt) {
            world->Step(dt);

            for (auto& cloth : cloths) {
                cloth->Update(dt, clothGravity);
            }

            accumulator -= dt;
        }

        Render();
    }
}

void Game::Cleanup() {
    world.reset();

    if (renderer) {
        SDL_DestroyRenderer(renderer);
        renderer = nullptr;
    }

    if (window) {
        SDL_DestroyWindow(window);
        window = nullptr;
    }

    SDL_Quit();
}

}

int main(int argc, char* argv[]) {
    Physics::Game game;

    if (!game.Initialize("2D Physics Sandbox", 900, 600)) {
        return 1;
    }

    game.Run();
    return 0;
}
